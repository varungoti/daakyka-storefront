import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyNewOrder } from "@/lib/orders/notify";
import { verifyPaymentSignature } from "@/lib/payments/razorpay";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { rateLimitOrResponse } from "@/lib/security/rate-limit";
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

  const { orderNumber, razorpayPaymentId, razorpayOrderId, razorpaySignature } = parsed.data;

  const order = await db.order.findUnique({ where: { number: orderNumber }, include: { items: true } });
  if (!order || order.razorpayOrderId !== razorpayOrderId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status === "PAID") {
    // Idempotent: a duplicate verify call (retry, double-submit) for an
    // order the webhook or a prior call already reconciled.
    return NextResponse.json({ ok: true, orderNumber: order.number });
  }

  if (!(await verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature))) {
    return NextResponse.json({ error: "Payment signature verification failed" }, { status: 400 });
  }

  let stockConflict = false;
  await db.$transaction(async (tx) => {
    for (const item of order.items) {
      if (!item.variantId) continue;
      const result = await tx.productVariant.updateMany({
        where: { id: item.variantId, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (result.count === 0) stockConflict = true;
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        razorpayPaymentId,
        adminNotes: stockConflict
          ? [order.adminNotes, "STOCK CONFLICT: manual review needed — an item sold out between order creation and payment."]
              .filter(Boolean)
              .join("\n")
          : order.adminNotes,
      },
    });
  });

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

  await notifyNewOrder({
    orderNumber: order.number,
    email: order.email,
    total: Number(order.total),
    currency: order.currency,
    fallback: false,
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, orderNumber: order.number });
}
