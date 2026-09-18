import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyNewOrder } from "@/lib/orders/notify";
import { verifyWebhookSignature } from "@/lib/payments/razorpay";

/**
 * Phase D3: reconciles orders when the browser closed (or the network
 * dropped) before POST /api/checkout/verify ran — Razorpay retries this
 * webhook independently of the client. The signature IS the
 * authentication; there is no session/bearer check, but an invalid or
 * missing `x-razorpay-signature` is always rejected before the body is
 * ever parsed or acted on.
 *
 * Idempotent on the Razorpay payment id, mirroring the existing Shopify
 * order webhook's dedupe-by-externalId check (see
 * src/app/api/webhooks/shopify/orders/route.ts): an order already marked
 * PAID with this payment id is left alone rather than reprocessed (so
 * stock is never decremented twice for the same payment).
 */

interface RazorpayWebhookPayload {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; status?: string } };
    refund?: { entity?: { id?: string; payment_id?: string } };
  };
}

async function handlePaymentCaptured(payment: { id?: string; order_id?: string }) {
  if (!payment.order_id || !payment.id) return;

  const order = await db.order.findFirst({
    where: { razorpayOrderId: payment.order_id },
    include: { items: true },
  });
  if (!order) return;

  // Idempotency: already reconciled (via /verify or an earlier delivery
  // of this same webhook event) with this exact payment id.
  if (order.status === "PAID" && order.razorpayPaymentId === payment.id) return;
  if (order.status === "PAID") return;

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
        razorpayPaymentId: payment.id,
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
          body: `Reconciled via the Razorpay webhook — payment captured but stock ran out. Manual review needed.`,
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
}

async function handlePaymentFailed(payment: { order_id?: string }) {
  if (!payment.order_id) return;
  const order = await db.order.findFirst({ where: { razorpayOrderId: payment.order_id } });
  if (!order || order.status === "PAID") return;

  await db.order.update({
    where: { id: order.id },
    data: {
      status: "CANCELLED",
      adminNotes: [order.adminNotes, "Payment failed (Razorpay webhook)."].filter(Boolean).join("\n"),
    },
  });
}

async function handleRefundProcessed(refund: { payment_id?: string }) {
  if (!refund.payment_id) return;
  const order = await db.order.findFirst({ where: { razorpayPaymentId: refund.payment_id } });
  if (!order || order.status === "REFUNDED") return;

  await db.order.update({ where: { id: order.id }, data: { status: "REFUNDED" } });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!(await verifyWebhookSignature(rawBody, signature))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: RazorpayWebhookPayload;
  try {
    event = JSON.parse(rawBody) as RazorpayWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    switch (event.event) {
      case "payment.captured": {
        const payment = event.payload?.payment?.entity;
        if (payment) await handlePaymentCaptured(payment);
        break;
      }
      case "payment.failed": {
        const payment = event.payload?.payment?.entity;
        if (payment) await handlePaymentFailed(payment);
        break;
      }
      case "refund.processed": {
        const refund = event.payload?.refund?.entity;
        if (refund) await handleRefundProcessed(refund);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("[webhooks/razorpay] processing failed", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
