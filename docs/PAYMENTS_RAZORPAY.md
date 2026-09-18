# Payments — Razorpay

Native checkout (`/checkout`) uses Razorpay for online payment when configured, and degrades to an
order-request flow when it isn't. Source: `src/lib/payments/razorpay.ts`,
`src/lib/payments/load-razorpay-script.ts`, `src/app/api/checkout/route.ts`,
`src/app/api/checkout/verify/route.ts`, `src/app/api/webhooks/razorpay/route.ts`.

## Environment variables

| Variable | Purpose |
|---|---|
| `RAZORPAY_KEY_ID` | Public key id, used both server-side (order creation) and returned to the client to open Checkout.js |
| `RAZORPAY_KEY_SECRET` | Secret key, used to create orders and verify the post-payment HMAC signature |
| `RAZORPAY_WEBHOOK_SECRET` | Separate secret configured in the Razorpay webhook settings, used to verify the `X-Razorpay-Signature` header |

`isRazorpayConfigured()` checks only `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`. But
`src/lib/env.ts`'s startup validation treats all **three** as a set: if any one of
`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` is set, all three must be —
a partial set throws at boot ("RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET
must all be set together — missing: ..."). If none are set, checkout falls back to the
order-request flow and a console warning is logged at startup — this is the current state of this
environment's `.env` (no Razorpay variables are set).

## Checkout flow

1. **`POST /api/checkout`** (`src/app/api/checkout/route.ts`) — rate-limited to 10 requests/minute.
   Validates the body against `checkoutSchema` (`src/lib/validation/schemas.ts`), then calls
   `createOrderFromCart()` (`src/lib/orders/create-order.ts`), which **re-prices every line
   server-side** from the current `ProductVariant` rows — client-submitted prices are never
   trusted. A best-effort lookup attaches the logged-in customer's id if there's a valid customer
   session, but a missing/broken session never blocks a guest checkout.
   - **Razorpay configured** (`isRazorpayConfigured()`): the order is created with
     `paymentMethod: "RAZORPAY"` and status `PENDING_PAYMENT`, then `createRazorpayOrder()` opens a
     matching order on Razorpay's side (amount in paise, `Math.round(order.total * 100)`) and its
     id is stored on `Order.razorpayOrderId`. The response returns
     `{ orderNumber, razorpayOrderId, keyId, amount, currency }` — enough for the browser to open
     Checkout.js. If Razorpay order creation itself fails, the local `Order` row is left as
     `PENDING_PAYMENT` with no `razorpayOrderId` (cleaned up later — see Stale orders, below) and
     the client gets a 502.
   - **Razorpay not configured**: the order is created with `paymentMethod: "ORDER_REQUEST"`,
     the customer is notified immediately (`notifyNewOrder(..., fallback: true)`), and the response
     is `{ orderNumber, fallback: true }` — no Razorpay fields at all. `CheckoutPageContent`
     (`src/components/checkout/checkout-page-content.tsx`) checks for `fallback` and skips the
     payment-modal step entirely in this case.
2. **Client-side** — on a non-fallback response, the browser loads Razorpay's Checkout.js exactly
   once via `loadRazorpayCheckoutScript()` (appends
   `<script src="https://checkout.razorpay.com/v1/checkout.js">`, dedupes repeat calls), then opens
   `new window.Razorpay({ key: keyId, order_id: razorpayOrderId, amount, currency, ... })`.
3. **`POST /api/checkout/verify`** (`src/app/api/checkout/verify/route.ts`) — rate-limited to 20
   requests/minute. On Checkout.js success, the client posts
   `{ orderNumber, razorpayPaymentId, razorpayOrderId, razorpaySignature }`. The route:
   - looks the order up by `orderNumber` and confirms `razorpayOrderId` matches what's on file
     (404 otherwise);
   - is **idempotent** — an order already `PAID` returns `{ ok: true }` immediately without
     re-verifying;
   - verifies the HMAC-SHA256 signature via `verifyPaymentSignature()`:
     `hmac_sha256(orderId + "|" + paymentId, RAZORPAY_KEY_SECRET)`, compared with a
     constant-time `safeEquals()` — a bad signature is a 400 and the order is left unpaid;
   - on success, **decrements stock** inside a transaction, one conditional `updateMany` per line
     (`WHERE id = variantId AND stock >= quantity`) — if a variant sold out between order creation
     and payment, that line's update simply affects 0 rows rather than erroring. Since the money
     has already been captured by Razorpay at that point, the order is still marked `PAID`; the
     stock conflict is instead recorded in `Order.adminNotes` and as an `AdminNotification`
     (`order_stock_conflict`) for manual review — the customer still sees a success page;
   - sends the order-confirmation notification (`notifyNewOrder(..., fallback: false)`).

## Webhook

**`POST /api/webhooks/razorpay`** (`src/app/api/webhooks/razorpay/route.ts`) reconciles orders
when the browser closes or the network drops before `/api/checkout/verify` runs — Razorpay retries
webhook delivery independently of the client, so this is the backstop, not the primary path.

- The `X-Razorpay-Signature` header **is** the authentication — there's no session/bearer check.
  `verifyWebhookSignature()` computes `hmac_sha256(rawRequestBody, RAZORPAY_WEBHOOK_SECRET)` against
  the **exact raw body bytes** (never a re-serialized `JSON.parse(...).toString()`, which can
  differ in whitespace/key order) and rejects with 401 before the body is ever parsed if it doesn't
  match.
- Handled events:
  - **`payment.captured`** — same stock-decrement-in-a-transaction + `PAID` logic as `/verify`.
    Idempotent by payment id: an order already `PAID` with this exact `razorpayPaymentId` is
    skipped; an order already `PAID` at all (e.g. `/verify` beat the webhook) is also left alone.
  - **`payment.failed`** — marks the order `CANCELLED` (unless it's already `PAID`, e.g. a
    late/out-of-order failed-event delivery after a successful capture) and appends a note to
    `adminNotes`.
  - **`refund.processed`** — looks the order up by `razorpayPaymentId` and marks it `REFUNDED`
    (unless already `REFUNDED`).
  - Any other event type is accepted (200) and ignored.

### Stale / abandoned orders

`POST /api/cron/cancel-stale-orders` (`src/app/api/cron/cancel-stale-orders/route.ts`, gated by
`authorizeCron()` / `CRON_SECRET` like the rest of the app's crons — see
[HARDENING.md](./HARDENING.md)) auto-cancels orders that are still `status: PENDING_PAYMENT`,
`paymentMethod: RAZORPAY`, have no `razorpayPaymentId`, and were created more than **30 minutes**
ago — i.e. a Razorpay order was opened but the customer never completed (or retried) payment. It
sets `status: CANCELLED` with an `adminNotes` entry ("Auto-cancelled: Razorpay payment not
completed within 30 minutes"). `ORDER_REQUEST` orders are never touched by this job — they never
enter `PENDING_PAYMENT` in the first place (see below).

## Order-request fallback (no Razorpay configured)

With no Razorpay keys set, `/api/checkout` creates the order with `paymentMethod: "ORDER_REQUEST"`
and returns `{ orderNumber, fallback: true }` immediately — there is no payment step, no
Checkout.js, and no `/verify` call. `createOrderFromCart()` (`src/lib/orders/create-order.ts`)
creates it straight into **`PROCESSING`** status (not `PENDING_PAYMENT`, since there's no online
payment gate to wait for) — treat it as "awaiting manual payment collection / follow-up," not as
paid. This is the active path in this environment today, since no Razorpay env vars are set.

## Content-Security-Policy

Already wired in `next.config.ts` — no changes needed to accept Razorpay in production:

```
script-src 'self' 'unsafe-inline' https://checkout.razorpay.com
connect-src 'self' https://api.razorpay.com
frame-src https://api.razorpay.com https://checkout.razorpay.com
```

`script-src` allows loading Checkout.js from Razorpay's CDN, `connect-src` allows the script's own
`fetch`/XHR calls to `api.razorpay.com`, and `frame-src` allows the payment modal's iframe. If you
ever see a CSP violation in the browser console during a Razorpay payment (e.g. after adding a new
payment method or Razorpay changes its infrastructure hosts), this is the block to update.

## Getting test-mode keys and a webhook

1. Sign up / log in at the [Razorpay Dashboard](https://dashboard.razorpay.com/), switch to
   **Test Mode** (toggle top-left).
2. **Settings → API Keys → Generate Test Key** — this gives you a `Key Id` and `Key Secret`. Set
   these as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. **Settings → Webhooks → Add New Webhook** — set the URL to
   `https://<your-deployment-host>/api/webhooks/razorpay`, subscribe to at least
   `payment.captured`, `payment.failed`, and `refund.processed`, and set a webhook secret. Set that
   secret as `RAZORPAY_WEBHOOK_SECRET`.
4. Test payments use Razorpay's published test card/UPI/netbanking credentials (see Razorpay's own
   test-mode docs) — no real money moves in test mode.
5. Restart the app (or redeploy) after setting all three variables — `src/lib/env.ts` validates
   them at startup and will refuse to boot in production with a partial set.

Rotate any key that was ever pasted in plaintext into chat, a ticket, or a non-`.env` file, the
same as for any other credential in this project.
