import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashOrderAccessToken } from "@/lib/orders/access-token";
import { notifyNewOrder } from "@/lib/orders/notify";
import { verifyPaymentSignature } from "@/lib/payments/razorpay";
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
 * gate — a conditional `updateMany({ where: { status: { not: "PAID" } } })`
 * inside the transaction — and stock is only ever decremented by whichever
 * caller's `updateMany` actually affects a row. The loser no-ops (no stock
 * touched, no duplicate notification) and still reports success. Keep this
 * file's transaction shape consistent with the webhook's.
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

  const order = await db.order.findUnique({ where: { number: orderNumber }, include: { items: true } });
  if (!order || order.razorpayOrderId !== razorpayOrderId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status === "PAID") {
    // Fast path only — NOT the correctness guarantee. This read happens
    // outside any lock, so it can be stale the instant this webhook and a
    // concurrent /verify call (or a webhook redelivery) both observe
    // non-PAID before either commits. The real gate is the conditional
    // `updateMany` inside the transaction below (F3): only whichever
    // caller actually flips the row to PAID may decrement stock.
    return NextResponse.json({ ok: true, orderNumber: order.number });
  }

  if (!(await verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature))) {
    return NextResponse.json({ error: "Payment signature verification failed" }, { status: 400 });
  }

  let stockConflict = false;
  let wonTransition = false;
  await db.$transaction(async (tx) => {
    // Atomic gate: `status: { not: "PAID" }` makes this a compare-and-swap
    // on the row itself. If a concurrent webhook delivery (or a duplicate
    // /verify call) already flipped it to PAID, this affects 0 rows and
    // we skip stock decrement entirely below — the loser must never touch
    // stock a second time for the same payment.
    const transition = await tx.order.updateMany({
      where: { id: order.id, status: { not: "PAID" } },
      data: { status: "PAID", razorpayPaymentId },
    });
    wonTransition = transition.count === 1;
    if (!wonTransition) return;

    for (const item of order.items) {
      if (!item.variantId) continue;
      const result = await tx.productVariant.updateMany({
        where: { id: item.variantId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (result.count === 0) stockConflict = true;
    }

    if (stockConflict) {
      await tx.order.update({
        where: { id: order.id },
        data: {
          adminNotes: [order.adminNotes, "STOCK CONFLICT: manual review needed — an item sold out between order creation and payment."]
            .filter(Boolean)
            .join("\n"),
        },
      });
    }
  });

  if (!wonTransition) {
    // Lost the race to the webhook (or an earlier /verify call): the order
    // is already PAID and stock was already decremented exactly once by
    // the winner. Still report success to the browser — nothing failed —
    // and skip the notification below so the customer isn't emailed twice.
    return NextResponse.json({ ok: true, orderNumber: order.number });
  }

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
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, orderNumber: order.number });
}
