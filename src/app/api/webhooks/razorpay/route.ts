import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { notifyNewOrder } from "@/lib/orders/notify";
import { markRazorpayOrderPaid, releaseOrderInventory } from "@/lib/orders/payment-transitions";
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
 * PAID is left alone rather than reprocessed (so stock is never
 * decremented twice for the same payment).
 *
 * F3 fix: this webhook (including a redelivery of the same event) can run
 * concurrently with /api/checkout/verify for the same order. The PAID
 * transition itself is the atomic gate — a conditional `updateMany`
 * inside the transaction — and stock is only ever decremented by
 * whichever caller's `updateMany` actually affects a row. The loser
 * no-ops (no stock touched, no duplicate notification) and this handler
 * still returns 200 to Razorpay so it doesn't retry forever.
 *
 * F-035/F-039 fix: `status: { not: "PAID" }` also matched
 * PROCESSING/SHIPPED/DELIVERED/REFUNDED, so a redelivered payment.captured
 * could regress an already-shipped-or-refunded order back to PAID and
 * decrement stock again — and payment.failed/refund.processed had the
 * same "only checks PAID" weakness, so a late failed-attempt event could
 * cancel an order the admin had already moved to PROCESSING/SHIPPED, and
 * any refund (including a partial one) marked the whole order REFUNDED.
 * The PAID gate and its side effects now live in markRazorpayOrderPaid
 * (src/lib/orders/payment-transitions.ts), shared with
 * src/app/api/checkout/verify/route.ts so the two can't drift apart
 * again; handlePaymentFailed and handleRefundProcessed below now use
 * their own tighter compare-and-swaps instead of a bare status read.
 */

interface RazorpayWebhookPayload {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
        /** Paise. Present on payment.captured/refunded events — used by
         * handleRefundProcessed to tell a partial refund from a full one. */
        amount?: number;
        amount_refunded?: number;
      };
    };
    refund?: { entity?: { id?: string; payment_id?: string; amount?: number } };
  };
}

async function handlePaymentCaptured(payment: { id?: string; order_id?: string }) {
  if (!payment.order_id || !payment.id) return;

  const order = await db.order.findFirst({
    where: { razorpayOrderId: payment.order_id },
    include: { items: true, appliedDiscount: true },
  });
  if (!order) return;

  // Fast path only — NOT the correctness guarantee. This read happens
  // outside any lock, so it can be stale the instant this webhook
  // (original delivery or a redelivery) races a concurrent /verify call.
  // The real gate is markRazorpayOrderPaid's conditional `updateMany`
  // (F-035/F3): only whichever caller actually flips the row to PAID may
  // decrement stock — see this file's header comment for exactly which
  // statuses are (and aren't) eligible.
  if (order.razorpayPaymentId !== null || !["PENDING_PAYMENT", "CANCELLED"].includes(order.status)) return;

  const { won: wonTransition, stockConflict, discountConflict } = await db.$transaction(
    (tx) => markRazorpayOrderPaid(tx, order, payment.id!),
    // F-255 fix — see the identical comment in checkout/verify/route.ts.
    { timeout: 15_000, maxWait: 5_000 },
  );

  if (!wonTransition) {
    // Lost the race to /verify (or an earlier delivery of this same
    // webhook event): the order is already PAID and stock was already
    // decremented exactly once by the winner. No-op cleanly — the caller
    // (POST below) still returns 200 so Razorpay doesn't retry forever —
    // and skip the notification so the customer isn't emailed twice.
    return;
  }

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

  if (discountConflict) {
    await db.adminNotification
      .create({
        data: {
          title: `Discount conflict on order ${order.number}`,
          body: `Reconciled via the Razorpay webhook — payment captured with code ${order.discountCode ?? "(unknown)"} but its usage limit filled up first. The customer already paid the discounted amount — manual review needed.`,
          type: "order_discount_conflict",
          metadata: JSON.stringify({ orderNumber: order.number, discountCode: order.discountCode }),
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
    // F-283 fix — see the identical comment in checkout/verify/route.ts.
    stockConflict: stockConflict || undefined,
  }).catch(() => undefined);
}

/**
 * F-039 fix: used to guard only `order.status === "PAID"`, so a late or
 * out-of-order payment.failed for an *earlier* failed attempt on the same
 * Razorpay order (Checkout lets the shopper retry) could cancel an order
 * the admin had already moved to PROCESSING or SHIPPED after a *later*
 * attempt succeeded. Restricted to a conditional `updateMany` that only
 * ever cancels a genuinely still-unpaid order.
 */
async function handlePaymentFailed(payment: { order_id?: string }) {
  if (!payment.order_id) return;
  const order = await db.order.findFirst({ where: { razorpayOrderId: payment.order_id } });
  if (!order) return;

  await db.order.updateMany({
    where: { id: order.id, status: "PENDING_PAYMENT", razorpayPaymentId: null },
    data: {
      status: "CANCELLED",
      // F-334: cancelledAt — see orderStatusTimestampField's doc comment.
      cancelledAt: new Date(),
      adminNotes: [order.adminNotes, "Payment failed (Razorpay webhook)."].filter(Boolean).join("\n"),
    },
  });
}

/**
 * F-039/F-036 fix: used to set REFUNDED on ANY refund.processed event with
 * no amount check (so a partial refund marked the whole order REFUNDED —
 * terminal, so it could never ship) and never gave back stock or the
 * discount redemption a full refund releases. Now: a partial refund only
 * appends a note (idempotent per refund id, since Razorpay can redeliver
 * this event); a full refund goes through the same conditional
 * `updateMany` + `releaseOrderInventory` pattern admin-orders.ts uses for
 * an admin-initiated refund/cancel (F-036), restricted to the statuses a
 * refund can legitimately follow.
 */
async function handleRefundProcessed(
  refund: { id?: string; payment_id?: string; amount?: number },
  payment?: { amount?: number; amount_refunded?: number },
) {
  if (!refund.payment_id) return;
  const order = await db.order.findFirst({
    where: { razorpayPaymentId: refund.payment_id },
    include: { items: true },
  });
  if (!order || order.status === "REFUNDED") return;

  const orderTotalPaise = Math.round(Number(order.total) * 100);
  const refundedPaise = payment?.amount_refunded ?? refund.amount ?? null;
  const totalPaise = payment?.amount ?? orderTotalPaise;
  const isFullRefund = refundedPaise !== null && refundedPaise >= totalPaise;

  if (!isFullRefund) {
    // Partial refund: never mark REFUNDED (that's terminal — the order
    // could then never ship). Record it for the admin instead, deduped on
    // the refund id so a webhook redelivery doesn't stack duplicate notes.
    const refundId = refund.id ?? "unknown";
    const alreadyNoted = order.adminNotes?.includes(`refund ${refundId}`) ?? false;
    if (!alreadyNoted) {
      const amountRupees = refundedPaise !== null ? (refundedPaise / 100).toFixed(2) : "unknown amount";
      const note = `Partial refund ₹${amountRupees} (refund ${refundId}) processed via Razorpay.`;
      await db.order.update({
        where: { id: order.id },
        data: { adminNotes: [order.adminNotes, note].filter(Boolean).join("\n") },
      });
    }
    return;
  }

  // Auto-restock only pre-shipment (PAID/PROCESSING) — once an order has
  // SHIPPED/DELIVERED, whether the goods actually come back is a real
  // question this webhook can't answer, so that case is left for manual
  // review rather than silently adding phantom stock back.
  await db.$transaction(
    async (tx) => {
      const preShipTransition = await tx.order.updateMany({
        where: { id: order.id, status: { in: ["PAID", "PROCESSING"] } },
        data: { status: "REFUNDED" },
      });
      if (preShipTransition.count === 1) {
        // F-036 fix: a refunded order's stock and any discount redemption
        // were committed at PAID and must come back, same as an
        // admin-cancelled paid order (src/lib/orders/admin-orders.ts).
        await releaseOrderInventory(tx, order);
        return;
      }

      await tx.order.updateMany({
        where: { id: order.id, status: { in: ["SHIPPED", "DELIVERED"] } },
        data: {
          status: "REFUNDED",
          adminNotes: [order.adminNotes, "Refunded via Razorpay after shipment — review whether the item(s) were returned before restocking."]
            .filter(Boolean)
            .join("\n"),
        },
      });
    },
    // F-255 fix — see the identical comment in checkout/verify/route.ts.
    { timeout: 15_000, maxWait: 5_000 },
  );
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
        const payment = event.payload?.payment?.entity;
        if (refund) await handleRefundProcessed(refund, payment);
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
