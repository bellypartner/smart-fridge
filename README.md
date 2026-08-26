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

**Batch-level QR, not per-instance.** The printed QR encodes a
`batchCode`, auto-generated as `SC-<fridge code>-<product code>-<YYMMDD>`
(e.g. `SC-FRIDGE-TECHNOPARK-001-CHISAL-260804` for "Chicken Salad", made
Aug 4 2026) — see `src/utils/batchCode.ts`. Shared by every unit in that
batch. You print one sheet per batch, not a unique label per box.

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
  without touching the database directly.

## Admin dashboard

A plain HTML/JS dashboard is served at **`/admin`** (e.g.
`https://pos.saladcaffe.com/admin`) — no separate deploy, no build step,
it's a static file served by the same Express app. First visit: use
"First time setup" to bootstrap the admin account (needs
`ADMIN_BOOTSTRAP_SECRET`), then it's a normal phone+password login from
then on. From there:

- **Categories** — create these first; the Product form's category field
  is a dropdown sourced from here, not free text.
- **Products** — includes a photo upload. The browser resizes it (long
  side capped at 800px, JPEG ~80% quality) and stores it as a base64 data
  URI directly on the product row — no S3 or file storage set up for this
  phase. Fine at pilot scale; worth moving to real object storage if the
  catalog grows into the hundreds or images need to be much larger.
- **Batches** — pick a fridge, product, manufactured date, and quantity.
  The batch code (`SC-<fridge code>-<product code>-<YYMMDD>`, e.g.
  `SC-FRIDGE-TECHNOPARK-001-CHISAL-260804` for "Chicken Salad") and expiry
  (from the product's shelf life) are generated for you — a live preview
  shows the code before you submit. Creating a batch also allocates its
  stock to the chosen fridge in the same step, so there's no separate
  "allocate stock" click for a brand-new batch (that's still there for
  topping up an *existing* batch at another fridge, or restocking later).
  Immediately after creating a batch, its QR modal opens automatically —
  see below.
- **QR codes** — every fridge and batch row has a **QR** button. Fridge
  QRs encode a link (`<your domain>/shop?fridge=<code>`) — this is what
  goes on the fridge itself, so scanning it with a phone camera opens the
  customer PWA directly, no app needed. Batch QRs encode just the raw
  batch code (what the PWA's in-app scanner reads to add it to a cart).
  Each QR modal offers **Download PNG** and **Print** — for batches,
  there's also a "copies to print" field (defaults to the quantity you
  just allocated) that lays out a grid of that many QR + label cards on
  one print job, sized for adhesive label sheets. Generated entirely in
  the browser (the `qrcode-generator` library, from a CDN) — no server
  round-trip,
  no third-party QR service seeing your codes.
- **Stock**, and (as ADMIN)
create additional staff logins — all without touching curl/Postman.

## API summary

```
POST   /api/auth/bootstrap-admin      { phone, password, name, secret } — one-time only
POST   /api/auth/login                { phone, password }              — staff
POST   /api/auth/staff                { phone, password, name, role }  — ADMIN only
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
POST   /api/admin/batches             ADMIN, KITCHEN — { productId, fridgeId, manufacturedAt, quantity } — code/expiry auto-derived, stock allocated in the same call
POST   /api/admin/fridges             ADMIN
POST   /api/admin/fridges/:id/stock   ADMIN, KITCHEN — restock after a service visit
GET    /api/admin/fridges/:id/stock   ADMIN, KITCHEN
GET    /api/admin/fridges             ADMIN, KITCHEN — list all fridges
GET    /api/admin/products            ADMIN, KITCHEN — list all products (includes category + image)
GET    /api/admin/batches             ADMIN, KITCHEN — list all batches
```

## Business rules encoded here

- No session-per-user dedupe (there's no user to dedupe on) — every
  `POST /api/sessions` call creates a fresh cart.
- Session expires after `SESSION_TTL_MINUTES` (default 20) of inactivity;
  each scan resets the clock. A background sweeper (`session.sweeper.ts`,
  runs every 60s) reaps stale sessions and releases their stock holds.
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
  from a CDN) with a live scan frame. Each successful scan shows a brief
  full-screen flash (product photo + name) and a phone vibration, then
  keeps scanning — no need to close/reopen the camera between items.
  Scanning the same code again within 2 seconds is ignored, so an
  accidental double-read of one sticker doesn't double-add it.
- **Manual code entry** — a fallback link is always visible in case the
  camera is denied, slow, or the sticker is damaged.
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

## Not in Phase 1 (next phases, on request)

- Kitchen/admin console beyond what's in `/admin` today
- Corporate wallet + monthly billing
- Loyalty/coupons
- Analytics dashboards
- Leakage report (physical count vs. `quantitySold` per fridge) — same
  shape as the existing inventory leakage tracker, worth wiring in early
  since there's no door lock to enforce payment in this phase

