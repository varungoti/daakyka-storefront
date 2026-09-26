import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashOrderAccessToken } from "@/lib/orders/access-token";
import { extractGuestName } from "@/lib/orders/admin-orders";
import { notifyNewOrder } from "@/lib/orders/notify";
import { markRazorpayOrderPaid } from "@/lib/orders/payment-transitions";
import { verifyPaymentSignature } from "@/lib/payments/razorpay";
import { revalidateProductStockForVariants } from "@/lib/products";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
import { safeEquals } from "@/lib/security/timing-safe-equal";
import { checkoutVerifySchema } from "@/lib/validation/schemas";

/**
 * Phase D3: verifies the Razorpay Checkout.js success callback and marks
 * the order PAID. Stock is decremented here (not at /api/checkout time)
 * via a conditional `updateMany` per line — if a line's stock ran out
 * between order creation and payment, that single line's update affects 0
 * rows. Since the money has already been captured by Razorpay at that
 * point, the payment is never failed for this: the order is flagged
 * (`adminNotes` + an `AdminNotification`) for manual review instead, and
 * the customer still sees success.
 *
 * F3 fix: this route and the Razorpay webhook (src/app/api/webhooks/razorpay/route.ts)
 * can both be triggered for the same payment (browser callback racing a
 * webhook delivery/redelivery). The PAID transition itself is the atomic
 * gate — a conditional `updateMany` inside the transaction — and stock is
 * only ever decremented by whichever caller's `updateMany` actually
 * affects a row. The loser no-ops (no stock touched, no duplicate
 * notification) and still reports success.
 *
 * F-035 fix: that gate used to be `status: { not: "PAID" }`, which also
 * matched PROCESSING/SHIPPED/DELIVERED/REFUNDED — so a replayed /verify
 * call (the shopper holds a permanently-valid signed payload) or a
 * redelivered webhook could regress an already-shipped-or-refunded order
 * back to PAID and decrement stock a second time. The gate, the fast-path
 * early return, and the stock/discount side effects now all live in
 * markRazorpayOrderPaid (src/lib/orders/payment-transitions.ts), shared
 * with the webhook's payment.captured handler, so the two can't drift
 * apart again. See that module's header comment for the exact rule.
 */
export async function POST(request: Request) {
  const limited = await rateLimitOrResponse(request, "checkout-verify", 20, 60_000);
  if (limited) return limited;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = checkoutVerifySchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid verification payload" }, { status: 400 });
  }

  const { orderNumber, razorpayPaymentId, razorpayOrderId, razorpaySignature, orderToken } = parsed.data;

  const order = await db.order.findUnique({
    where: { number: orderNumber },
    include: { items: true, appliedDiscount: true },
  });
  if (!order || order.razorpayOrderId !== razorpayOrderId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.razorpayPaymentId !== null || !["PENDING_PAYMENT", "CANCELLED"].includes(order.status)) {
    // Fast path only — NOT the correctness guarantee. This read happens
    // outside any lock, so it can be stale the instant this route and a
    // concurrent webhook delivery both observe an eligible order before
    // either commits. The real gate is markRazorpayOrderPaid's conditional
    // `updateMany` below (F-035/F3): only whichever caller actually flips
    // the row to PAID may decrement stock, and every status this order
    // could only have reached *after* a first successful payment
    // (PROCESSING, SHIPPED, DELIVERED, REFUNDED, or a paid-then-cancelled
    // order that already carries a razorpayPaymentId) short-circuits here
    // rather than being re-processed as if it were a fresh payment.
    return NextResponse.json({ ok: true, orderNumber: order.number });
  }

  if (!(await verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature))) {
    return NextResponse.json({ error: "Payment signature verification failed" }, { status: 400 });
  }

  const { won: wonTransition, stockConflict, discountConflict } = await db.$transaction(
    (tx) => markRazorpayOrderPaid(tx, order, razorpayPaymentId),
    // F-255 fix: explicit budget, matching create-order.ts/admin-orders.ts
    // — markRazorpayOrderPaid's stock decrement is one bulk statement (see
    // its own doc comment), so this is a safety net, not a fix for a known
    // slow path here.
    { timeout: 15_000, maxWait: 5_000 },
  );

  if (!wonTransition) {
    // Lost the race to the webhook (or an earlier /verify call): the order
    // is already PAID and stock was already decremented exactly once by
    // the winner. Still report success to the browser — nothing failed —
    // and skip the notification below so the customer isn't emailed twice.
    return NextResponse.json({ ok: true, orderNumber: order.number });
  }

  // release-hardening audit F-017: won the CAS above, so this call actually
  // decremented stock for `order.items` — without this, the PDP/listing
  // cache keeps serving pre-payment stock/availability until an unrelated
  // admin catalog edit happens to revalidate the same tags. Best-effort —
  // must never fail a response for an already-captured payment.
  await revalidateProductStockForVariants(
    order.items.map((item) => item.variantId).filter((id): id is string => id !== null),
  );

  if (stockConflict) {
    await db.adminNotification
      .create({
        data: {
          title: `Stock conflict on order ${order.number}`,
          body: `Payment was captured for ${order.number} but one or more items ran out of stock before payment completed. Manual review needed.`,
          type: "order_stock_conflict",
          metadata: JSON.stringify({ orderNumber: order.number }),
        },
      })
      .catch(() => undefined);
  }

  if (discountConflict) {
    await db.adminNotification
      .create({
        data: {
          title: `Discount conflict on order ${order.number}`,
          body: `Payment was captured for ${order.number} with code ${order.discountCode ?? "(unknown)"} but its usage limit filled up before payment completed. The customer already paid the discounted amount — manual review needed.`,
          type: "order_discount_conflict",
          metadata: JSON.stringify({ orderNumber: order.number, discountCode: order.discountCode }),
        },
      })
      .catch(() => undefined);
  }

  // orderToken is client-supplied and only ever used to decide whether the
  // confirmation email gets a direct link — it plays no part in
  // authorizing this request (the Razorpay signature check above already
  // did that). Re-verified against the order's own stored hash so a
  // caller can't smuggle an unrelated/garbage value into the email.
  const confirmedOrderToken =
    orderToken && order.accessTokenHash && safeEquals(hashOrderAccessToken(orderToken), order.accessTokenHash)
      ? orderToken
      : undefined;

  await notifyNewOrder({
    orderNumber: order.number,
    email: order.email,
    total: Number(order.total),
    currency: order.currency,
    fallback: false,
    orderToken: confirmedOrderToken,
    // F-073 fix: lets notifyNewOrder enroll this order in the
    // "order_created" post-purchase journey with a real phone/name.
    phone: order.phone ?? undefined,
    firstName: extractGuestName(order.shippingAddress)?.split(" ")[0],
    // F-283 fix: a stock conflict here means the payment was captured for
    // an item that's no longer available — notifyNewOrder must not promise
    // "we'll let you know as soon as it ships" in that case (see its own
    // doc comment). stockConflict is deliberately omitted (undefined, not
    // false) on the normal path rather than always passed, so this stays a
    // no-op for every other caller of notifyNewOrder.
    stockConflict: stockConflict || undefined,
  }).catch(() => undefined);

  // stockConflict is surfaced here (additive — existing callers that don't
  // read it are unaffected) so a future confirmation-page/email update can
  // tell the shopper honestly, rather than only ever reaching adminNotes.
  return NextResponse.json({ ok: true, orderNumber: order.number, stockConflict });
}
