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
`batchCode` (e.g. `SC-PANEER-BOWL-B240804`), shared by every unit in that
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

**Staff (KITCHEN/ADMIN): phone + OTP**, unchanged from before.
`POST /api/auth/otp/request` → SMS (stubbed to console log in this phase —
swap `smsProvider` in `auth.service.ts` for MSG91/Twilio). `POST
/api/auth/otp/verify` returns a short-lived access JWT (15 min) and a
rotating refresh token (30 days, hashed at rest, single-use). Note: any
phone number that completes OTP verification is auto-created as a
`KITCHEN` user on first login — fine for a small trusted pilot team, but
worth switching to admin-provisioned staff accounts before this is opened
up more widely.

## API summary

```
POST   /api/auth/otp/request          { phone }                    — staff only
POST   /api/auth/otp/verify           { phone, code, name? }        — staff only
POST   /api/auth/refresh              { refreshToken }              — staff only
POST   /api/auth/logout               { refreshToken }              — staff only

GET    /api/fridges/:code             resolve fridge from its code — public, no auth

POST   /api/sessions                  { fridgeCode }                → starts an anonymous cart, no auth
GET    /api/sessions/:id/cart
POST   /api/sessions/:id/scan         { batchCode }                → add/increment cart item
PATCH  /api/sessions/:id/cart/:itemId { quantity }                 → 0 removes the item
POST   /api/sessions/:id/checkout     { name, phone }               → mandatory, freezes cart, creates Razorpay order

GET    /api/orders/:id                open lookup by order id (the id is the receipt key)

POST   /api/payments/webhook          Razorpay webhook (payment.captured / payment.failed)

POST   /api/admin/products            ADMIN
POST   /api/admin/batches             ADMIN, KITCHEN
POST   /api/admin/fridges             ADMIN
POST   /api/admin/fridges/:id/stock   ADMIN, KITCHEN — restock after a service visit
GET    /api/admin/fridges/:id/stock   ADMIN, KITCHEN
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

## Not in Phase 1 (next phases, on request)

- Customer PWA (React/Vite/Tailwind) and Kitchen/Admin console
- Corporate wallet + monthly billing
- Loyalty/coupons
- Analytics dashboards
- Leakage report (physical count vs. `quantitySold` per fridge) — same
  shape as the existing inventory leakage tracker, worth wiring in early
  since there's no door lock to enforce payment in this phase

