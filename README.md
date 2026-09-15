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

**`/auth/login` and `/auth/bootstrap-admin` are deliberately excluded**
from the silent-refresh logic above — a real bug had a wrong-password
login attempt trigger the *exact same* "your session expired" alert and
forced reload as an actually-expired session, which was confusing and
wrong: a 401 from either of those two endpoints means "incorrect
credentials," not "your access token needs refreshing" (there isn't one
yet at that point in the flow). What was actually happening: the login
attempt's 401 got intercepted by the generic retry logic, which tried
to silently refresh using whatever leftover refresh token happened to
still be sitting in `sessionStorage` from a previous session, that
attempt failed too (nothing to refresh against), and *that* failure is
what triggered the scary alert — masking the real "wrong password"
message the person should have seen instead. `api()` now checks the
request path and skips the refresh-retry branch entirely for these two
endpoints, letting a real credentials error surface normally on the
login form.

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
POST   /api/admin/orders/:orderId/refund   ADMIN only — records a refund (manual — doesn't call Razorpay)
POST   /api/admin/expenses            ADMIN only — { description, category?, amount, incurredOn }
GET    /api/admin/expenses            ADMIN only — ?from&to to scope to a period
DELETE /api/admin/expenses/:id        ADMIN only
GET    /api/admin/profitability       ADMIN only — ?from&to (required) — the Sales/Refunds/COGS/Wastage/Gross/Net breakdown
```

## Business rules encoded here

- No session-per-user dedupe (there's no user to dedupe on) — every
  `POST /api/sessions` call creates a fresh cart.
- Session expires after `SESSION_TTL_SECONDS` (default **45**, renamed
  from `SESSION_TTL_MINUTES` when the default dropped from 10 minutes —
  a name still in minutes stopped making sense at this duration) of
  inactivity; each scan resets the clock. A background sweeper
  (`session.sweeper.ts`, runs every 15s — also shortened, from 60s, so
  the sweep interval doesn't eat up a big chunk of a now much shorter
  TTL) reaps stale sessions and, critically, **releases their held
  stock back to `quantityAvailable`** — this is the answer to "what
  happens to an abandoned cart": if someone scans an item and never
  checks out, that item goes back to being purchasable by someone else
  within about a minute, not the up-to-11-minutes an earlier 10-minute
  default allowed (scan-and-immediately-abandon blocking the next
  customer from buying an item that's physically just sitting right
  there was a real reported problem, not a hypothetical one). 45s
  specifically avoids being *so* short that comparing two items or
  reading nutrition info before deciding releases your own held item
  while you're still actively shopping — a literal 10-20s window was
  considered and rejected for exactly that reason.

  **A completed checkout is unaffected by this value no matter how
  short it is** — `checkout()` flips the session's `status` from
  `ACTIVE` to `CHECKED_OUT` before the Razorpay popup ever opens, and
  the sweeper's query only ever matches `status: "ACTIVE"` sessions.
  There's no dependence on `expiresAt` surviving long enough to cover
  an actual payment.

  Note: if this was already deployed with `SESSION_TTL_MINUTES` set
  explicitly in Railway's Variables, that variable is simply unused
  now — add `SESSION_TTL_SECONDS` there instead (or leave it unset to
  use the 45s code default) and remove the old one.
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
then weight/volume and price combined onto one line (e.g. `180g · Pay
₹150`), then expiry date **and time** — all stacked on the left, bold
throughout; a **19mm×19mm QR code in its own column on the right, with
the batch code printed directly underneath it** — the same visual
convention as a "SCAN HERE" caption sitting right under a QR, just with
the actual code there instead. This matters operationally: if a scan
ever fails — camera trouble, a damaged or smudged label — there's
still a human-readable code that can be typed into the shop app's
"Can't scan? Enter the code" fallback, so a failed scan never means the
item is simply unbuyable. An earlier version ran the code along the
full width of the label below everything else rather than directly
under the QR; this replaced that, both to visually match the "QR with
a caption under it" convention and to make the QR itself the dominant
element on the label. The narrower column this puts the code text in
means a genuinely long fridge code has more real chance of needing to
truncate than the old full-width strip did — it's clamped to 2 lines
with a trailing `…` if it overflows, rather than silently cutting
characters with no indicator; the QR always encodes the complete,
untruncated code regardless; only the human-readable caption for an
unusually long code would ever come up short.

**The price line shows the actual selling price, not MRP — on purpose.**
If a customer can't scan and just calculates by hand what to pay via the
backup bank QR (see "Manual sales" below), printing MRP would have them
overpay relative to what the app itself would actually charge. The
customer PWA's cart mirrors this the other way: it shows MRP
struck-through next to the real selling price whenever they differ, the
same "you're paying less than MRP" framing a printed discount label
would use, just on-screen.

**QR size is 19mm×19mm** — sized up from an earlier, smaller version
after real-world feedback that a number of phone cameras couldn't
reliably read it at the smaller size. Legibility of the physical label
took priority over fitting the absolute maximum text on it; see the
label-sizing history further down for how this was balanced against the
other content on a fixed 25mm-tall label.

**Products can be weighed in grams or measured in mL** —
`Product.weightGrams` for solid/semi-solid food, `Product.volumeMl` for
liquids like juices. A product should only have one of the two set; the
label shows whichever is present (`180g` or `250ml`) instead of always
assuming grams.

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

**Default filters — what's live right now, not everything ever made.**
Both the Batches and Stock tabs default to a filtered view instead of
showing every row ever created:

- **Batches tab** defaults to **"Today, active"** — batches manufactured
  today with `status: ACTIVE`. Switch the dropdown to "All batches" to
  see everything, still sorted newest-manufactured-first. This is a
  client-side filter over data already fetched — switching it doesn't
  trigger a new request, and it doesn't affect which batches the Stock
  tab's "Allocate stock" dropdown offers (that's still any `ACTIVE`
  batch with quantity remaining, regardless of manufacture date —
  allocating from yesterday's still-active batch is entirely valid).
- **Stock tab** defaults to **"Live today"** — stock whose batch is
  `ACTIVE` and manufactured today, i.e. what's actually sellable right
  now. Switching to **"Closed out"** shows the opposite: anything whose
  batch is no longer `ACTIVE` (closed out via the button below, or
  `RECALLED`) — this is where a batch "goes" once it's been closed out,
  separate from the live view rather than just disappearing, so a
  physical-count check against yesterday's Close-out can still happen
  without it cluttering today's live list. "All" shows everything. All
  three modes sort newest-manufactured-first.

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
customer, **what was actually in the order** — e.g. `2× Chicken Salad,
1× Paneer Bowl`, not just an item count — and total). The customer
order-history modal (opened from the Customers tab) shows the same
per-order breakdown. All computed from `Order`/`OrderItem` rows already
being written by the existing checkout/webhook flow — `productNameSnapshot`
on each `OrderItem` was already being stored, so this was purely a
dashboard rendering change, nothing new to track.

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

## Customer feedback

Two separate public QR/link flows, entirely distinct from the shopping
one — fridge feedback (from a physical location) and subscription
feedback (from an ongoing service relationship, not tied to any fridge).
Both share the same design principle: **name is the one required
field, everything else is optional.**

### Fridge feedback — `/feedback`

- **Public form** — a required name field, an optional phone number
  ("if you want us to call, leave your number"), then two clearly
  separated sections: **Food** (star ratings for taste, quantity,
  quality, and "how likely to recommend us," plus a short suggestion
  box) and **Service** (its own rating and comment, deliberately kept
  apart from the food ratings — a bad checkout experience shouldn't drag
  down a good meal's rating or vice versa). Every field past name is
  independently optional, and tapping an already-selected star clears
  it. Rate-limited (5/minute) purely to blunt a spam flood, not to
  constrain a genuine customer. Name is enforced client-side (so a
  customer sees the problem immediately, right next to the field) and
  server-side (so the requirement can't be bypassed by skipping the
  page's JS) — but kept nullable at the *database* level rather than a
  hard `NOT NULL` constraint, since that column already existed as
  optional before this requirement was added, and a schema-level
  constraint change risks failing against any rows that predate it.
- **Fridge context, optionally.** A feedback QR can be scoped to one
  fridge (`/feedback?fridge=<code>`) or left generic. Fridge-scoped ones
  show "Feedback for <fridge name>" and tag the submission with that
  fridge; a generic one doesn't. Each fridge row in the dashboard has
  its own **Feedback QR** button (same 50×25mm thermal-label print path
  already built for fridge/batch QRs — no new print logic, just a
  different destination URL) alongside its regular shop QR; the Feedback
  tab also has a "Print a general feedback QR" option for a single
  universal one if you'd rather not scope it per fridge.
- `GET /api/admin/feedback/stats` and `GET /api/admin/feedback` (both
  ADMIN only) back the dashboard; `POST /api/feedback` is the public
  submission endpoint. An unresolvable `fridgeCode` on submission never
  fails the request — it just means no fridge gets attached, since a bad
  QR code shouldn't be able to silently eat someone's feedback.

### Subscription feedback — `/subscription-feedback`

A **separate model and question set** from fridge feedback — a
subscription customer isn't scanning anything physical (you'd send this
link directly, e.g. over WhatsApp after a delivery), and the questions
don't overlap enough to share a table without it turning into a pile of
nullable fields that only half apply to either side.

- **Public form** — required name, optional phone, then three grouped
  sections: **Your experience** (overall satisfaction, on-time delivery,
  results toward their goal), **The food** (quality, quantity,
  packaging, plus a free-text "favorite meals so far"), and **A bit
  more** (how likely to recommend to a friend, suggestions, additional
  requests). Same validation approach as fridge feedback — name required
  client- and server-side, everything else optional.
- `GET /api/admin/subscription-feedback/stats` and
  `GET /api/admin/subscription-feedback` (ADMIN only);
  `POST /api/subscription-feedback` is the public submission endpoint.

### Delivery feedback (Swiggy/Zomato) — `/feedback-delivery`

**Shares the `Feedback` table with fridge feedback above** — same
question set (Taste/Quantity/Quality/Recommend + a food suggestion,
Service kept separate) since the two are genuinely identical, just
reached differently: a `source` column (`"fridge"` | `"swiggy_zomato"`,
null meaning `"fridge"` for rows from before this field existed)
distinguishes them instead of duplicating every rating field a second
time the way subscription feedback's genuinely different questions
warranted.

- **The one real difference: phone is mandatory here**, not optional —
  a delivery-platform customer is worth following up with directly;
  enforced both client-side (the form won't submit without it) and
  server-side (`createDeliveryFeedbackSchema` in feedback.schema.ts).
  No fridge context, since a Swiggy/Zomato order was never picked up
  from a physical fridge.
- `POST /api/feedback-delivery` is the public submission endpoint
  (writes to the same table with `source: "swiggy_zomato"`).
  `GET /api/admin/feedback` and `/stats` both accept an optional
  `?source=fridge|swiggy_zomato` filter — the dashboard's Fridge and
  Swiggy/Zomato views are the same rendering code, just scoped by this.

### Dashboard

All three live under the same **"Feedback"** nav tab, switched with a
toggle at the top (**Fridge feedback** / **Swiggy/Zomato feedback** /
**Subscription feedback**) rather than three separate sidebar entries —
each shows its own stat cards (averages shown with the sample count
behind them, e.g. `4.2 ★ (12)`, so a small sample never looks as
confident as a large one — only entries that actually rated a given
field count toward its average) and its own submissions table with the
full set of columns for that feedback type.

## Profitability — cost tracking, refunds, expenses, gross/net margin

```
Gross Profit  = Sales − Refunds − COGS − Wastage cost
Gross Margin  = Gross Profit ÷ Sales × 100
Net Profit    = Gross Profit − Expenses
```

**Cost price, snapshotted per batch.** `Product.costPrice` is what it
costs to make one unit — optional, entered in the Products tab. When a
batch is created, that cost is copied onto `Batch.costPricePerUnit` at
that moment, the same way `OrderItem.unitPrice` already snapshots the
selling price at checkout — so a later cost change doesn't retroactively
rewrite what a batch someone already sold or wasted actually cost to
make. Both are nullable: a product with no cost set simply has no cost
data attached to its batches, rather than defaulting to zero.

**COGS and wastage cost are computed, not manually entered.** COGS sums
`batch.costPricePerUnit × quantity` across every `OrderItem` on a
`PAID`/`REFUNDED` order in the report period; wastage cost does the same
against `FridgeStock.quantityWasted`. Any item or wasted unit whose
batch has no cost price is **excluded, not assumed to cost zero** — the
`getProfitability()` response includes `itemsMissingCost` and
`wastedUnitsMissingCost`, and the dashboard shows a visible warning when
either is non-zero, so an incomplete number is never mistaken for a
correct one. Set a cost price in the Products tab to fix this going
forward — it doesn't retroactively fix past batches, since those already
have their own (missing) snapshot.

**Refunds are a manual record, not a live payment reversal.** There's no
Razorpay refund API integration — `POST /api/admin/orders/:id/refund`
just records that a refund happened (amount, capped at the order total)
against an already-`PAID` order, flips its status to `REFUNDED` (an enum
value that existed from the start but had no way to actually be set
until now), and logs it to `AuditLog`. Process the actual refund in
Razorpay's dashboard first, then record it here so the numbers match
reality. A **Refund** button appears next to any `PAID` order in the
Sales tab's order list, right where **Mark as paid** appears for
`PENDING` ones.

**Expenses are the layer between Gross and Net.** A separate `Expense`
model — free-text description, optional category, amount, and a date
(`incurredOn`) that's independent of when it was entered, so a rent
payment logged late still counts toward the month it was actually for).
Deliberately not part of the Gross Profit calculation — COGS and
wastage are costs of the goods themselves; rent, salaries, and the like
are a different layer, which is why the formula stops at Gross Profit
before subtracting them.

**Dashboard "Profitability" tab** (ADMIN only) — a from/to date range
(defaults to month-to-date), a breakdown card showing the full formula
top to bottom with the running total bolded at each stage, and an
expense add/list/delete panel scoped to the same date range. Both
`Sales`/`Refunds` and `Wastage cost` are period-filtered differently on
purpose: sales and refunds are anchored to the order's `paidAt` (so a
sale and a later refund against it land in the same report rather than
splitting across two periods), while wastage is anchored to the batch's
`manufacturedAt` rather than `FridgeStock.updatedAt` — the latter can be
bumped by an unrelated later correction (see "Perishable stock" above),
so it isn't a reliable "when did this actually get wasted" timestamp;
a batch is already treated as one day's production everywhere else in
this app, so its waste is treated as belonging to that same day too.

### Manual sales — for when the scan-and-pay system is down

A backup bank/UPI QR is posted at each fridge for exactly this case: the
in-app system is down (or a customer just prefers it), so they take the
item and pay that QR directly instead. Those units are genuinely sold,
not wasted — but the app has no `Order` for them, since there's no
session or Razorpay payment behind a transaction it never saw. Without
some way to record that, a physical stock count at close-out would have
no way to explain the gap except calling it waste, which would be wrong.

**`ManualSale`** is a separate, minimal model for exactly this: fridge,
batch, quantity, and a snapshot of the product's selling price at the
moment it's recorded. Recording one (`POST
/api/admin/fridges/:fridgeId/stock/manual-sale`, or the **Manual sale**
button next to **Close out** in the Stock tab — ADMIN or KITCHEN, since
this happens at the fridge in the moment, not from an office desk)
reduces `FridgeStock` exactly the way a real sale would
(`quantityAvailable` down, `quantitySold` up), and can't exceed what's
actually available. `getProfitability()` folds manual-sale revenue and
COGS into the same `sales`/`cogs` totals as app orders — the response
(and the Profitability tab's breakdown card) splits `Sales` into three
sub-lines — `appSales`, `manualQrSalesTotal`, and `vendingSalesTotal` —
so it's visible exactly how much of a period's revenue came from each
individual channel, not lumped into one "manual" figure.

**Vending machine sales share this same model**, via a `channel` field
(`"bank_qr"` default, or `"vending_machine"`) rather than a second
table — the reconciliation problem and the fix are identical, just a
different real-world source. The Stock tab has a **Vending sale**
button right next to **Manual sale**; both call the same endpoint with
a different `channel` in the body.

**Corrections.** There was no way to fix a mistyped quantity after
recording one of these — the Profitability tab's "Manual & vending
sales in this period" table now has **Edit** and **Delete** for exactly
that. Edit (`PATCH /api/admin/manual-sales/:id`) applies only the
*difference* between the old and new quantity to `FridgeStock` — not
the full new quantity again — and keeps the originally-snapshotted unit
price, since this is a quantity correction, not a re-sale at today's
price. Delete (`DELETE /api/admin/manual-sales/:id`) fully reverses the
sale's stock effect (units go back to `quantityAvailable`, out of
`quantitySold`) before removing the record — for when one was recorded
in error entirely, not just with the wrong number.

## A dedicated marketing label for feedback QRs

Every feedback QR (generic, fridge-scoped, Swiggy/Zomato, subscription)
used to print with the same plain "name + QR + code" template as a
fridge's shop QR. It now has its own design instead, based on a
reference the user supplied: **"Send us your Feedback / Complaints"**
+ **"Next time order at saladcaffe.com"** on the left, a large QR with
a **"SCAN HERE"** caption directly under it on the right —
`.thermal-label-feedback` in the CSS, selected via a `qrState.isFeedback`
flag every feedback-QR opener function sets (and every non-feedback one
explicitly clears, since `qrState` is a single shared object reused
across every QR type printed in a session). The heading wraps across
lines on its own — getting `Feedback / Complaints` to wrap naturally
at the slash instead of running off the edge needed actual spaces
around it in the markup; a browser won't break a line at a bare `/`
the way it will at a space.

**Price label adjustments**, all on the same 50mm×25mm physical label:

- QR grew from 19mm to 21mm.
- The caption column under the QR grew from 19mm to 24mm — wider than
  the QR image itself. This wasn't optional: once the QR reached 21mm,
  even the user's actual (short) real batch code started truncating in
  testing, not just an artificially long stress-test one. Widening the
  column past the QR's own width fixed that. It's a single line with an
  ellipsis, not a 2-line clamp — a 2-line attempt was tested and it
  visibly overflowed the label's fixed height once the QR grew this
  much, since there's no space left over as it was before.
- "Pay ₹X" became "Price ₹X", split onto its own bold/bigger line
  (`.tl-price-line`, distinct from the plain `.tl-line` class Mfg/Exp
  use) so it's the most prominent number on the label after the item
  name.
- **Weight/volume gets its own small dedicated line** (`.tl-weight-line`)
  — not combined with Exp, and not combined with Price either. Both
  combinations were tried first and both genuinely shipped: a real
  printed label came back with weight missing entirely, because
  "Exp `<date+time>` · `<weight>`" was wider than the space actually
  available once the QR column grew, and the overflow was being
  silently clipped by `overflow: hidden` with no visible sign anything
  was missing — confirmed by both character-width math and a true-size
  render reproducing the exact same line. Combining weight with Price
  instead hit the identical problem at the bigger font. There was
  plenty of unused vertical space once the real constraint turned out
  to be horizontal, not height, so weight now gets its own line instead
  of fighting either of the other two for width.

All of the above was verified the same way as previous label
changes — rendered at true physical size, margins measured precisely
(not eyeballed), and the QR decoded back to confirm it matches exactly,
including a stress test with a deliberately long fridge code to check
the truncation behavior stays safe rather than silently dropping
characters.

## Location-scoped feedback QRs (Swiggy/Zomato and subscription)

Fridge feedback has always been optionally scoped to a fridge via
`?fridge=<code>` in the link. Swiggy/Zomato and subscription feedback
have no fridge to attach to, but can still be scoped to a **kitchen or
location** the same way, via a free-text `location` field on both
`Feedback` and `SubscriptionFeedback` — not tied to any existing
entity (there's no separate "Location" model), just a plain string
tag, since a delivery order or a subscription customer was never
picked up from a specific physical fridge unit.

Generating one: the **"Print a feedback QR"** card (Feedback tab →
Swiggy/Zomato view, and separately in the Subscription view) has a
dropdown — **Generic (no location)**, every location already used, or
**"+ Add new location…"** — rather than a blind one-off prompt like an
earlier version had. Picking an existing location reprints the exact
same link; adding a new one saves it (`QrLocation`, a small table just
remembering which location strings have been used per QR type — the
`location` field itself is still just a plain string on `Feedback`/
`SubscriptionFeedback`, not a foreign key) before printing, so it shows
up in the dropdown for next time too. This exists specifically because
the original prompt-based version had no way to find "what locations
have I already made a QR for" later — each one only ever existed as a
one-off result, easy to lose track of or accidentally retype slightly
differently. The public form shows "Feedback for <location>" near the
top when the link carried one, the same convention fridge feedback
already used.

## Expense categories — pick existing or add new, sub-totaled in the statement

The Profitability tab's expense category field was free text before —
now it's a dropdown of every category ever used
(`GET /api/admin/expenses/categories`, distinct values from past
`Expense` rows) plus a **"+ Add new category…"** option that reveals a
text input when selected. This exists specifically to stop "Rent" and
"rent" from silently becoming two different categories in the
breakdown just from inconsistent typing.

The Profitability breakdown card's "− Expenses (this period)" line now
has its own sub-lines underneath, one per category with that category's
total for the period (uncategorized expenses group under
"Uncategorized" rather than being dropped) — so the statement shows
what expenses actually consist of, not one opaque lump sum.

## Mobile grid layout — a real pre-existing bug, not just Stock

While building a mobile-friendly Stock tab (below), found that the base
`.grid`/`.grid-2` rules (the two-column "form on left, table on right"
layout used by nearly every tab — Fridges, Batches, Products, Stock)
were declared **after** their mobile media-query override in the
stylesheet. Since CSS resolves equal-specificity ties by source order
regardless of which rule is inside a media query, the unconditional
desktop rule (`340px 1fr`) was winning even at phone widths, squeezing
the second column down to a sliver instead of collapsing to one column
as the media query intended. This wasn't a Stock-specific issue — every
tab using `.grid` was affected. Fixed by moving the base rule before the
media query. Verified on two different tabs (Stock and Fridges) at
phone width, and confirmed desktop is pixel-identical to before at
laptop width.

## Stock tab on mobile — cards instead of a table

The Stock tab is what gets used from a phone most often — standing at
the fridge, checking or correcting stock. An 8-column table with 4
action buttons per row doesn't work as a horizontally-scrolling table
on a phone screen. Below the same `768px` breakpoint used elsewhere,
the table (`.stock-table-desktop`) is hidden and a card layout
(`#stockCardsMobile`) takes over instead — one card per stock row,
product name and a match-check badge (see below) up top, batch code
and date, the same available/held bar, a compact Allocated/Sold/Wasted
line, then all the actions (Manual sale, Vending sale, Close out, Edit,
Delete) as full-width, easy-to-tap buttons in a 2-column grid. Both the
table and the cards are built from the same computed row data in
`renderStockTable()` in one pass, so the mismatch-detection logic (next
section) only exists in one place rather than being duplicated between
the two layouts.

## A visible warning when Sold + Wasted + Available + Held doesn't add up

Reported directly: a stock row showing `Allocated: 2, Sold: 2, Wasted:
1` — mathematically impossible, since that's 3 units accounted for out
of only 2ever allocated. There wasn't previously any validation
anywhere (not in the automatic sale/close-out flow, not in the manual
quantity-correction Edit form) ensuring
`Sold + Wasted + Available + Held <= Allocated`. Rather than guess at
the exact historical sequence that produced one specific bad row, or
add blocking validation that could get in the way of a legitimate but
unusual correction, this adds a purely visual warning: any row where
the numbers don't reconcile gets a `⚠ check` badge (hover/tap for the
exact math) and a subtle highlight, on both the desktop table and the
mobile cards. It doesn't block or auto-correct anything — it just makes
a row worth checking impossible to miss instead of sitting there
silently wrong.

## Batch total quantity is now correctable

`updateBatchStatus` (status only) became `updateBatch` (status and/or
`totalQuantity`) — there was no way to fix a mistyped total production
count after the fact. The Edit modal for a batch now has both fields.
Correcting `totalQuantity` down below what's already been allocated to
fridges is allowed — it just means "available to assign" for that batch
can go negative, which is accurate information (more was already given
out than the corrected total), not an error state to prevent.

## Kitchen can see Feedback ratings, but not generate QR codes

The Feedback tab (ratings, reports, submissions across all three
audiences) was ADMIN-only; now both ADMIN and KITCHEN can view it —
`GET /api/admin/feedback`, `/stats`, and the subscription-feedback
equivalents all now accept either role. Generating a new (or
reprinting an existing) feedback QR stays ADMIN-only, both server-side
(`POST /api/admin/qr-locations` and its `GET` still require ADMIN) and
in the dashboard — the "Print a feedback QR" cards in all three
Feedback views, and the per-fridge "Feedback QR" button in the Fridges
tab, are hidden entirely for KITCHEN rather than shown-then-blocked.

## Not in Phase 1 (next phases, on request)

- Kitchen/admin console beyond what's in `/admin` today
- Corporate wallet + monthly billing
- Loyalty/coupons
- Deeper analytics (peak hours, customer frequency/repeat rate, expiry
  loss, average order value) beyond what the Sales tab covers today
- Leakage report (physical count vs. `quantitySold` per fridge) — same
  shape as the existing inventory leakage tracker, worth wiring in early
  since there's no door lock to enforce payment in this phase

