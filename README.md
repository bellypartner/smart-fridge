# Salad Caffe Smart Fridge — API (Phase 1)

QR self-checkout for chillers in offices/IT parks. This phase is the backend
only: architecture, database, auth, and the full order-to-payment API.

**Pilot model this phase implements:** no electronic door lock, and no
login for customers. Customer opens the app (scoped to a fridge), scans
each **batch-level QR** (one code per SKU+batch, bulk printed — not a
unique label per unit) as they take an item, then pays. Name and phone are
collected as plain required fields at checkout — not OTP-verified, just
captured for the receipt/contact. Staff (kitchen/admin) still log in via
OTP to manage products, batches, and stock. A lock-controlled version can
sit in front of this same order/payment core later without touching it.

---

## Architecture

```
src/
  config/       env validation, Prisma client singleton, Razorpay client
  middleware/   auth guard (staff only), role guard, rate limits, validation, error handler
  modules/
    auth/       staff OTP login (KITCHEN/ADMIN) — customers never use this
    fridge/     resolve a fridge by its printed QR code — fully public
    session/    anonymous shopping session, batch scan → cart, stock holds
    order/      checkout (captures name+phone) → Razorpay order, order lookup by id
    payment/    Razorpay webhook (the only thing that finalizes an order)
    admin/      product / batch / fridge creation, stock allocation — staff only
  app.ts        express wiring
  index.ts      entrypoint + graceful shutdown + session sweeper
prisma/
  schema.prisma
  seed.ts       sample fridge/product/batch/stock for local testing
tests/          DB-independent unit tests (otp hashing, ApiError)
```

## Data model — the decisions that shape everything else

**A batch is a production run, not a fridge assignment.** `Batch` has no
fridge on it at all — it's just a product, a manufactured date, an
auto-computed expiry, and a `totalQuantity` (how much was made). Getting
units into a specific fridge is a separate step: `FridgeStock` links a
batch to a fridge with its own quantity, and one batch can have many
`FridgeStock` rows across different fridges. This matches a central
kitchen model — produce 100 units in one run, then distribute them
across 3 fridges in whatever split makes sense, all from the one batch.
(Earlier versions of this app tied a batch to one fridge at creation
time, which didn't match that workflow — this was restructured after
that mismatch came up directly.)

**Batch-level QR, not per-instance.** The printed QR encodes a
`batchCode`, auto-generated as `<product code>-<DDMM>` (e.g.
`CHISAL-0408` for "Chicken Salad", made Aug 4) — see
`src/utils/batchCode.ts`. No "SC" prefix and no fridge in the code
(since a batch isn't fridge-specific — see above), and the date is
day+month only (no year) — a same-day collision across different years
is vanishingly rare, and the code falls back to a `-2`, `-3`, ... suffix
automatically if it ever happens. Note: this format has changed twice
now — batches created under an earlier version keep their original code
(some with a fridge in it, some with `SC-`); nothing retroactively
renames an already-printed label. Shared by every unit in that batch.
You print one sheet per batch (or rather, one per unit you're
distributing — see "copies to print" below), not a unique label per box.

**No customer login.** `ShoppingSession` and `Order` are anonymous —
there's no `User` behind them. The session id returned by
`POST /api/sessions` is the only thing a customer's device needs to keep
scanning into the same cart (held client-side, e.g. localStorage). At
checkout, `customerName`/`customerPhone` are captured directly on the
`Order` as plain required fields — unverified, for receipt/contact only.
`User` now exists only for staff (KITCHEN/ADMIN) who still log in via OTP
to manage products, batches, fridges, and stock.

**Stock holds, not stock deduction, at scan time.** Every `FridgeStock` row
tracks three numbers: `quantityAvailable`, `quantityHeld`, `quantitySold`.
Scanning a batch increments `quantityHeld` (inside a transaction) so two
customers can't both "win" the last item while one is still mid-checkout.
Only a **confirmed** Razorpay `payment.captured` webhook converts a hold
into a sale (`quantityAvailable -= n`, `quantityHeld -= n`,
`quantitySold += n`). If a session expires or payment fails, the hold is
released back to available stock. This is also why prices are stamped
onto `CartItem`/`OrderItem` at scan time — never trust a client-supplied
price at checkout.

Every batch scan is checked against `FridgeStock` for *that specific
fridge* — this is what rejects a batch scanned at the wrong fridge. For
this pilot phase there's no interactive "scan the fridge QR" step; the app
just needs a `fridgeCode` to open a session against (see "assumption" below).

## Auth

**Customers: none.** `POST /api/sessions`, `/scan`, `/cart`, and
`/checkout` have no auth middleware at all.

**Staff (KITCHEN/ADMIN): phone + password**, not OTP — SMS was never wired
to a real provider, so OTP had no way to actually reach anyone. The OTP
endpoints (`/otp/request`, `/otp/verify`) still exist in the code for
whenever a provider is added, but the login you'll actually use is:

- `POST /api/auth/bootstrap-admin` — **one-time only.** Creates the very
  first ADMIN account. Requires `ADMIN_BOOTSTRAP_SECRET` (set this in
  Railway) as a `secret` field in the body, alongside `phone`, `password`,
  `name`. Refuses to run a second time once any ADMIN exists in the
  database, regardless of the secret — so it's safe to leave the env var
  set afterward.
- `POST /api/auth/login` — `{ phone, password }` → the normal login for
  everyone after that first admin exists.
- `POST /api/auth/staff` — ADMIN-only. Lets an admin create more staff
  accounts (`phone`, `password`, `name`, `role: "ADMIN" | "KITCHEN"`)
  without touching the database directly. `GET /api/auth/staff` lists
  every account (no password hashes in the response), and
  `PATCH /api/auth/staff/:id` updates role and/or deactivates one — the
  dashboard's Staff tab shows this real list now (it originally only
  showed accounts created in that browser session, which meant a phone
  number collision on create had no way to be checked or explained
  beforehand — fixed by actually loading the real roster from the
  database instead of a client-side-only list).

**Token lifetime and the dashboard's silent refresh.** Access tokens
expire after `JWT_ACCESS_EXPIRES_IN` (default 15 minutes) — intentional,
standard practice for a bearer token. What isn't intentional is being
logged out mid-task because of it: the dashboard's `api()` helper now
catches a `401`, silently exchanges the stored refresh token for a new
access token via `POST /api/auth/refresh`, and retries the original
request once — invisibly, so in-progress form input is never lost to a
surprise logout. Only a genuinely dead session (refresh token itself
expired, `JWT_REFRESH_EXPIRES_IN`, default 30 days — or explicitly
logged out) falls through to a real re-login prompt. Logging out now
also calls `POST /api/auth/logout` to revoke that device's refresh token
server-side, not just forget it locally.

**Multiple devices logged in at once was already supported** and still
is — logging in issues a new refresh token without revoking any other
device's existing one (each login just adds a row to `RefreshToken`), so
a phone and a laptop can hold independent sessions for the same account
simultaneously. What looked like a single-device restriction before this
fix was actually the missing silent-refresh above, hitting each device
independently every 15 minutes.

## Admin dashboard

A plain HTML/JS dashboard is served at **`/admin`** (e.g.
`https://pos.saladcaffe.com/admin`) — no separate deploy, no build step,
it's a static file served by the same Express app. First visit: use
"First time setup" to bootstrap the admin account (needs
`ADMIN_BOOTSTRAP_SECRET`), then it's a normal phone+password login from
then on.

**Responsive down to phone width**, scoped entirely inside a
`max-width: 768px` media query so desktop is untouched above that: the
permanent sidebar becomes a slide-in drawer behind a hamburger button,
grids collapse to one/two columns, and any table wider than the screen
(the Sales tab's Recent Orders, for instance) scrolls horizontally
within its own card instead of breaking the page layout. Verified with
real browser screenshots at both phone width and a normal laptop width
during development, not just by reading the CSS.

From there:

- **Categories** — create these first; the Product form's category field
  is a dropdown sourced from here, not free text.
- **Products** — includes a photo upload. The browser resizes it (long
  side capped at 800px, JPEG ~80% quality) and stores it as a base64 data
  URI directly on the product row — no S3 or file storage set up for this
  phase. Fine at pilot scale; worth moving to real object storage if the
  catalog grows into the hundreds or images need to be much larger.
- **Batches** — pick a product, manufactured date, and **total quantity
  produced**. No fridge here — a batch isn't tied to one. The batch code
  (`<product code>-<DDMM>`, e.g. `CHISAL-0408` for "Chicken Salad") and
  expiry (from the product's shelf life) are generated for you — a live
  preview shows the code before you submit. Immediately after creating a
  batch, its QR modal opens automatically, defaulted to print the full
  quantity produced — see below. The Batches table shows **Made** (total
  produced) and **Available to assign** (how much of that hasn't been
  allocated to any fridge yet) per batch.
- **Stock** — this is where a batch's production actually reaches a
  fridge. Pick a fridge and a batch, enter a quantity, and it's added to
  that fridge's stock — repeat across as many fridges as you're
  distributing this batch to. The batch dropdown shows each batch's
  remaining "available to assign" quantity right in the label, and only
  offers `ACTIVE` batches that still have something left to give out; a
  batch already fully distributed (or one that's `EXPIRED`/`RECALLED`)
  won't be offered. Allocating more than a batch's recorded total
  quantity is rejected outright — the error tells you exactly how much
  is actually left. Selecting a fridge here also checks it for any
  `ACTIVE` batch still sitting with leftover stock and shows a
  non-blocking orange reminder to Close it out first — almost always
  yesterday's batch that never got closed.
- **QR codes** — every fridge and batch row has a **QR** button. Fridge
  QRs encode a link (`<your domain>/shop?fridge=<code>`) — this is what
  goes on the fridge itself, so scanning it with a phone camera opens the
  customer PWA directly, no app needed. Batch QRs encode just the raw
  batch code (what the PWA's in-app scanner reads to add it to a cart).
  Each QR modal offers **Download PNG** and **Print** — for batches,
  there's also a "copies to print" field, defaulting to however much of
  that batch is still unallocated (the whole `totalQuantity` right after
  creation; less than that if you're reprinting after some has already
  been assigned to fridges). See "Printing batch labels on a real
  thermal printer" further down for the actual print layout — it's sized
  to a real 50mm×25mm label printer, not a cut-apart sheet. Generated
  entirely in the browser (the `qrcode-generator` library, from a CDN) —
  no server round-trip, no third-party QR service seeing your codes.
- **Stock**, and (as ADMIN)
create additional staff logins — all without touching curl/Postman.

## API summary

```
POST   /api/auth/bootstrap-admin      { phone, password, name, secret } — one-time only
POST   /api/auth/login                { phone, password }              — staff
POST   /api/auth/staff                { phone, password, name, role }  — ADMIN only
GET    /api/auth/staff                ADMIN only — every staff account (passwordHash excluded)
PATCH  /api/auth/staff/:id            ADMIN only — update role and/or isActive
POST   /api/auth/refresh              { refreshToken }                 — staff
POST   /api/auth/otp/request          { phone }                        — unused until SMS is wired
POST   /api/auth/otp/verify           { phone, code, name? }           — unused until SMS is wired
POST   /api/auth/logout               { refreshToken }              — staff only

GET    /api/fridges/:code             resolve fridge from its code — public, no auth

POST   /api/sessions                  { fridgeCode }                → starts an anonymous cart, no auth
GET    /api/sessions/:id/cart
POST   /api/sessions/:id/scan         { batchCode }                → add/increment cart item
PATCH  /api/sessions/:id/cart/:itemId { quantity }                 → 0 removes the item
POST   /api/sessions/:id/checkout     { name, phone }               → mandatory, freezes cart, creates Razorpay order

GET    /api/orders/:id                open lookup by order id (the id is the receipt key)

POST   /api/payments/webhook          Razorpay webhook (payment.captured / payment.failed)

POST   /api/admin/categories          ADMIN — create a category (create these before products)
GET    /api/admin/categories          ADMIN, KITCHEN
POST   /api/admin/products            ADMIN
POST   /api/admin/batches             ADMIN, KITCHEN — { productId, manufacturedAt, totalQuantity } — no fridge; code/expiry auto-derived, no stock allocated yet
POST   /api/admin/fridges             ADMIN
POST   /api/admin/fridges/:id/stock   ADMIN, KITCHEN — allocate part of a batch's production to this fridge; capped against the batch's totalQuantity
GET    /api/admin/fridges/:id/stock   ADMIN, KITCHEN
GET    /api/admin/fridges             ADMIN, KITCHEN — list all fridges
GET    /api/admin/products            ADMIN, KITCHEN — list all products (includes category + image)
GET    /api/admin/batches             ADMIN, KITCHEN — list all batches, each with computed allocatedSoFar/remaining
GET    /api/admin/orders              ADMIN only — ?status= and/or ?fridgeId= filters, most recent 200
GET    /api/admin/orders/stats        ADMIN only — total/today revenue+orders, best sellers, revenue by fridge
POST   /api/admin/orders/:orderId/mark-paid   ADMIN only — manually unstick a PENDING order whose webhook never fired (see below)

PATCH  /api/admin/categories/:id      ADMIN — rename
DELETE /api/admin/categories/:id      ADMIN — blocked if any product uses it
PATCH  /api/admin/products/:id        ADMIN — any field, including a new photo
DELETE /api/admin/products/:id        ADMIN — blocked if any batch exists for it
PATCH  /api/admin/batches/:id         ADMIN, KITCHEN — { status: ACTIVE|EXPIRED|RECALLED }
DELETE /api/admin/batches/:id         ADMIN, KITCHEN — blocked if it has real order history
PATCH  /api/admin/fridges/:id         ADMIN — name, location, isActive
DELETE /api/admin/fridges/:id         ADMIN — blocked if it has stock/sessions/orders
PATCH  /api/admin/fridges/:fridgeId/stock/:batchId   ADMIN, KITCHEN — sets exact quantityAvailable and/or quantityWasted (either or both)
DELETE /api/admin/fridges/:fridgeId/stock/:batchId   ADMIN, KITCHEN — blocked while quantityHeld > 0
POST   /api/admin/fridges/:fridgeId/stock/:batchId/close-out   ADMIN, KITCHEN — records leftover as waste, zeroes availability, flips batch to EXPIRED
GET    /api/admin/customers           ADMIN only — grouped by phone, with spend/frequency
GET    /api/admin/customers/:phone    ADMIN only — that customer's full order history
```

## Business rules encoded here

- No session-per-user dedupe (there's no user to dedupe on) — every
  `POST /api/sessions` call creates a fresh cart.
- Session expires after `SESSION_TTL_MINUTES` (default **10**, changed
  from 20) of inactivity; each scan resets the clock. A background
  sweeper (`session.sweeper.ts`, runs every 60s) reaps stale sessions
  and, critically, **releases their held stock back to `quantityAvailable`**
  — this is the answer to "what happens to an abandoned cart": if someone
  scans an item and never checks out, that item goes back to being
  purchasable by someone else after ~10 minutes of inactivity, same as it
  would if they'd never picked it up. Note: if this was already deployed
  with `SESSION_TTL_MINUTES` set explicitly in Railway's Variables, that
  value overrides this code default — update it there too if you want the
  shorter window live.
- Checkout is idempotent per session — re-hitting checkout on an already
  `PENDING` order returns the same order instead of creating a duplicate.
  Checkout requires `name` and `phone` in the body (phone validated as a
  10-digit Indian mobile number) — neither is verified, they're captured
  for the receipt/contact only.
- The webhook handler is idempotent — a duplicate `payment.captured`
  delivery is a no-op if the order is already `PAID`.
- Webhook signature is verified with a constant-time compare against the
  raw request body — this route is mounted with `express.raw()` *before*
  the global `express.json()` middleware for exactly this reason.

## Assumption worth flagging

Dropping the "scan the fridge QR to start" step means the app needs a
`fridgeCode` from *somewhere* when it calls `POST /api/sessions`. This
phase assumes a single-fridge pilot — the frontend can hardcode/configure
`FRIDGE-TECHNOPARK-001`. If you roll out to a second fridge before the PWA
is built with fridge selection, say so and I'll wire in a lightweight way
to pick the fridge (e.g. a URL parameter baked into a QR sticker still
physically on the fridge, just without any login/session-creation
ceremony attached to scanning it).

## Local setup

```bash
cp .env.example .env        # fill in DATABASE_URL, JWT secrets, Razorpay keys
npm install
npx prisma migrate dev      # creates the schema
npx prisma db seed          # sample fridge FRIDGE-TECHNOPARK-001 + one batch
npm run dev
```

Test the customer flow with curl/Postman — no login needed:
create session against `FRIDGE-TECHNOPARK-001` → scan
`SC-PANEER-BOWL-B240804` → checkout with `{ name, phone }` → simulate the
Razorpay webhook locally with their CLI or a signed test payload.

## Deploy to Railway

1. New Railway project → add a **PostgreSQL** plugin (sets `DATABASE_URL`
   automatically).
2. Add this repo as a service → Railway auto-detects Node via Nixpacks.
3. Set env vars from `.env.example` (JWT secrets, Razorpay keys/webhook
   secret, `NODE_ENV=production`).
4. `railway.toml` is already wired to run `prisma migrate deploy` before
   `npm start` on every deploy, and points Railway's healthcheck at
   `/health`.
5. Point the Razorpay webhook URL at
   `https://<your-railway-domain>/api/payments/webhook`, subscribed to
   `payment.captured` and `payment.failed`.

## Customer PWA

Served at **`/shop`** (e.g. `https://pos.saladcaffe.com/shop?fridge=<code>`)
— a plain HTML/JS/CSS app, no build step, no login. Each fridge's printed
QR sticker just links to its own `?fridge=` code.

- **Scan** — opens straight to the camera (via the `html5-qrcode` library
  from a CDN); the on-screen scan-region box is drawn entirely by that
  library, not a second custom overlay — an earlier version drew its own
  decorative frame independently positioned via CSS, which could visibly
  drift out of alignment with the library's real scan region across
  different phone screens (that's fixed now). Each successful scan shows
  a brief full-screen flash (product photo + name) and a phone vibration,
  then keeps scanning — no need to close/reopen the camera between items.
  Scanning the same code again within 2 seconds is ignored, so an
  accidental double-read of one sticker doesn't double-add it.
- **Manual code entry** — a fallback link is always visible in case the
  camera is denied, slow, or the sticker is damaged; the modal notes that
  codes are case-sensitive, since that's a real way this can silently fail
  otherwise.
- **Cart** — a bottom sheet with live quantity controls and totals,
  reflecting exactly what the server has (never trusts client-side math).
- **Checkout** — collects name + phone (mandatory, per the backend),
  then opens Razorpay's own hosted Checkout popup.
- **Payment confirmation** — after Razorpay's popup reports success
  client-side, the app shows "Confirming your payment…" and polls
  `GET /api/orders/:id` every 2s until the *webhook* has actually marked
  it `PAID` — the same principle the backend already enforces (never
  trust the client alone) carried through to the UI. Falls back to a
  "still confirming" message after ~40s rather than spinning forever.
- **Installable** — a manifest + minimal service worker let a repeat
  customer "Add to Home Screen." The service worker only caches the
  static shell for faster repeat loads; it deliberately never caches
  `/api/` calls, since this is a live-payment app where correctness
  matters far more than offline support.
- **Session reuse** — the session id from `POST /api/sessions` is saved
  in `localStorage` per fridge code, so reopening the page (or the
  installed app) within the 20-minute session window continues the same
  cart instead of starting over.

Icons at `public/shop/icons/` are placeholders (a green square with "SC")
— swap in real exported icons whenever you have brand assets ready.

**Bug fixed while building this:** a failed payment used to permanently
block any further checkout attempt on that session, because the `FAILED`
order row stayed in place and the unique constraint on `Order.sessionId`
rejected a second one. Checkout now clears a `FAILED` order and creates a
fresh attempt, so a declined card or cancelled payment popup is retryable.

## Printing batch labels on a real thermal printer

The QR print output is sized for a **50mm × 25mm thermal label
printer** (the actual hardware in use) — not a cut-apart sheet on
regular paper. Each copy prints as its own physical label
(`@page { size: 50mm 25mm; margin: 0 }`, `page-break-after: always`
between copies), so set your printer/driver's label size to match and
"Print" sends one label per copy directly.

Layout: item name (bold, large) with manufactured date **and time**,
then weight and MRP combined onto one line (e.g. `180g · MRP ₹150`),
then expiry date **and time** — all stacked on the left, bold
throughout; a QR code on the right; and a **readable text strip along
the bottom printing the batch code itself** (not just encoded in the
QR). This matters operationally: if a scan ever fails — camera trouble,
a damaged or smudged label — there's still a human-readable code that
can be typed into the shop app's "Can't scan? Enter the code" fallback,
so a failed scan never means the item is simply unbuyable.

Dates on the Mfg/Exp lines drop the year (e.g. `27/08 6:30 PM`, not
`27/08/26 6:30 PM`) specifically to make room for the time without
shrinking the font — the batch code's own `DDMM` suffix still carries
the date unambiguously if the year is ever needed. Time is always
12-hour with AM/PM (`formatLabelTime()` in the dashboard's script),
including the midnight/noon edge cases (`12:00 AM`/`12:00 PM`, not
`0:00`).

**Text sizing was tuned against actual printed labels, not just a
screen preview** — twice. The first pass measured fine on-screen but
printed with the detail lines and code strip too small and thin to read
on the real thermal head; small, non-bold text loses definition on
thermal printers in a way a monitor or PDF preview doesn't show. That
was fixed with bold, larger text. A second round pushed the batch code
strip larger still (now 3mm bold, up from an already-enlarged 2.6mm) to
make it unmistakably legible, and adding the Mfg/Exp times meant
re-checking that the now-longer detail lines still fit without silently
truncating (`white-space: nowrap` + `overflow: hidden` clips text with
no visual indicator if a line runs too wide — unlike the code strip,
which shows `…`). Verified by rendering at true size with the longest
realistic content (name that wraps to two lines, both times present, a
deliberately long fridge code) and zooming into the rendered text to
directly confirm nothing — including the trailing "AM"/"PM" — gets cut
off, not just checking that the label's overall box stayed within
bounds.

The code strip is also always a single line — an earlier version let a
very long code wrap to a second line, which made the label's total
content height unpredictable and could push content past the physical
25mm boundary; it now truncates with `…` instead (the QR always encodes
the complete, untruncated code regardless, so scanning is never
affected — only the rare case of an unusually long fridge code would
ever show a shortened fallback text).

Add a product's **Weight (g)** in the Products tab to have it appear on
the label; leave it blank to omit that line. Expiry isn't a separate
field anywhere — it's always `manufacturedAt + Product.shelfLifeHours`,
computed automatically and shown in the Batches table's Expires column
(see "Auto-generated batch codes" above).

Fridge QR labels use a simpler version of the same template (just the
fridge name, a larger QR, and the fridge code as the bottom strip) at the
same physical size, since a fridge sticker is printed once, not per batch.

## Perishable stock — daily close-out and waste tracking

Because this is fresh food, whatever's left unsold at the end of a day
gets physically thrown away — the Stock tab now reflects that instead of
just letting old stock sit there silently.

Two new fields on `FridgeStock`:
- **`quantityAllocated`** — an immutable running total of everything ever
  put into this batch at this fridge (incremented only by creating a
  batch or restocking it). Shown as **Made** in the Stock tab. Manual
  corrections (the Edit button) never touch this, so it stays an honest
  record even after a count correction.
- **`quantityWasted`** — cumulative units recorded as thrown away. Shown
  as **Wasted**.

The **Close out** button on each stock row is the daily routine: it
takes whatever's currently in `quantityAvailable`, records that exact
amount as waste, zeroes availability so it can never be sold again, and
flips the batch to `EXPIRED` (unless it's already `RECALLED`) so the
Batches tab honestly shows it's done for the day. It deliberately leaves
`quantityHeld` alone — a cart still in flight resolves itself through the
existing session-expiry/webhook paths, not this action.

With this, each row in the Stock tab reads as **Made → Sold → Wasted**
for that batch — since a batch is inherently one day's production (the
date is baked into its code), this *is* the daily made/sold/wasted view,
no separate "daily" tab needed. Daily revenue is still the Sales tab's
"Today" stat cards, which need no manual step.

**Remote close-out vs. physical count.** If Close-out happens from the
office — before anyone's physically at the fridge to count what's
actually left — the recorded waste is only as good as the system's
`quantityAvailable` at that moment, which can be off from reality by the
time someone's there in person (a scan that failed silently, a stray
sale mid-transit, a miscount when the fridge was originally stocked).
The **ideal order is: count physically, correct if needed, then Close
out** — that way the recorded number is never a guess. When that's not
practical and Close-out happens first, `quantityWasted` on the Edit
form is directly correctable, same as `quantityAvailable` always has
been — so once someone's physically there and finds a different count,
fix the wasted number to match reality. Worth knowing what a mismatch
might mean: found *fewer* than the system expected is worth treating as
a possible shrinkage signal (theft, or a scan/accounting gap) rather
than ordinary food waste; found *more* is usually just a miscount or an
early close-out, lower-stakes to correct.

**Suggested daily routine:** each morning, Close out any batch from the
previous day that still shows leftover stock at a given fridge (Stock
tab), then create today's fresh batch in the Batches tab and allocate
it out to whichever fridges it's going to (Stock tab again).

## Editing and deleting

Every entity created in the dashboard (Categories, Fridges, Products,
Batches, Stock) now has **Edit** and **Delete** buttons in its table.
Delete is deliberately conservative — it's blocked with a clear message
wherever real data depends on the row, rather than silently orphaning
history or cascading a destructive delete:

- A **category** can't be deleted while any product still uses it.
- A **product** can't be deleted while any batch exists for it —
  deactivate it instead (the `isActive` toggle in its edit form).
- A **fridge** can't be deleted once it has any stock, sessions, or
  orders against it — same deactivate-instead pattern.
- A **batch** can't be deleted once it has real order history — mark it
  `RECALLED` instead (an editable status, alongside `ACTIVE`/`EXPIRED`).
- A **stock** row can't be deleted while a customer currently has it held
  in an active cart.

One thing worth knowing: `Fridge.isActive` is already enforced —
`POST /api/sessions` refuses to start a session against an inactive
fridge. `Product.isActive`, however, isn't enforced anywhere yet (a
deactivated product's existing batches are still scannable) — the toggle
exists in the UI, but wiring it into the scan/batch-creation flow is a
small follow-up if you want deactivation to actually block new sales of
that product, not just hide it from the create-product dropdown mentally.

## Customer analytics

The **Customers** tab (ADMIN only) groups paid orders by phone number —
that's the only stable identity available, since there's no customer
login (name can vary between visits; phone is what actually identifies a
repeat customer). For each customer: total orders, total spent, last
order date, and a frequency label:

- **New** — exactly one order so far
- **Frequent** — averaging 7 days or less between orders
- **Regular** — averaging 8–21 days between orders
- **Occasional** — averaging more than 21 days between orders

Click a row to see that customer's full order history (date, fridge,
items, total, status) in a detail view. Like the Sales tab, this is
computed in application code over all paid orders — fine at pilot
volumes, worth revisiting with real SQL aggregation if order volume
grows substantially.

## Sales dashboard

The `/admin` dashboard's **Sales** tab (ADMIN only — not shown to KITCHEN
staff, since revenue is sensitive) shows: total and today's revenue and
paid-order counts, a best-sellers table (by quantity), revenue broken
down by fridge, and a filterable list of recent orders (status, fridge,
customer, item count, total). All computed from `Order`/`OrderItem` rows
already being written by the existing checkout/webhook flow — nothing
new to track, just a new view onto it.

Stats are aggregated in application code (fetch all `PAID` orders, sum in
JS) rather than a SQL `GROUP BY` — simple and fast enough at pilot order
volumes (hundreds, maybe low thousands). Worth moving to real SQL
aggregation, or a cron-computed summary table, if order volume grows into
the tens of thousands.

**"Mark as paid" override.** Every `PENDING` order in the Recent Orders
list has a Mark as paid button. This exists for one specific failure
mode: Razorpay genuinely captured the payment, but the webhook never
reached the server (misconfigured secret, wrong URL, a temporary outage)
so the order is stuck at `PENDING` forever even though the customer was
charged. Clicking it runs the exact same stock-conversion logic the
webhook itself uses (`quantityHeld`/`quantityAvailable` → `quantitySold`,
session closed) so the two paths stay consistent — the only difference
is this one is triggered by a logged-in admin instead of Razorpay, and
it's logged to `AuditLog` as `ORDER_MARKED_PAID_MANUALLY` (distinct from
the webhook's own `ORDER_PAID` action) with that admin's user id attached,
so there's always a record of who used it and when. It's a deliberate
escape hatch, not a substitute for fixing a broken webhook — use it only
after confirming in Razorpay's own dashboard that the payment actually
captured.

## Not in Phase 1 (next phases, on request)

- Kitchen/admin console beyond what's in `/admin` today
- Corporate wallet + monthly billing
- Loyalty/coupons
- Deeper analytics (peak hours, customer frequency/repeat rate, expiry
  loss, average order value) beyond what the Sales tab covers today
- Leakage report (physical count vs. `quantitySold` per fridge) — same
  shape as the existing inventory leakage tracker, worth wiring in early
  since there's no door lock to enforce payment in this phase

