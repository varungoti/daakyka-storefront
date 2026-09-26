import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeCron } from "@/lib/cron/authorize";
import { markRazorpayOrderPaid } from "@/lib/orders/payment-transitions";
import { fetchCapturedPaymentId } from "@/lib/payments/razorpay";

/**
 * Phase D3: cancels Razorpay orders that never completed payment.
 * ORDER_REQUEST orders are never touched here — they move straight to
 * PROCESSING at creation (see createOrderFromCart) since there's no
 * online payment step to wait for, so this cron's
 * `paymentMethod: RAZORPAY` filter already excludes them without any
 * extra condition.
 *
 * Deliberately does NOT restock: a RAZORPAY order only reaches this
 * query pre-payment (`razorpayPaymentId: null`), and per
 * createOrderFromCart's design note (src/lib/orders/create-order.ts),
 * stock for a RAZORPAY order is never decremented until payment is
 * verified — so there is nothing to give back here. Contrast with an
 * admin cancelling an ORDER_REQUEST order (src/lib/orders/admin-orders.ts,
 * "Finding B"), which DOES restock, because that payment method
 * decrements stock immediately at creation. Adding a restock step here
 * would double-restore inventory that a Razorpay order never actually
 * reserved.
 *
 * F-225 fix: this used to cancel every stale candidate on elapsed time
 * alone, with no check against Razorpay. Payments are auto-captured
 * (payment_capture: true — src/lib/payments/razorpay.ts), so a shopper
 * whose browser closes mid-UPI-app-switch right after paying — before
 * POST /api/checkout/verify ever runs — leaves a genuinely *paid* order
 * looking identical to an abandoned one, and if the webhook is
 * unreachable or was never configured in the Razorpay dashboard, nothing
 * else would ever reconcile it. Each candidate is now checked against
 * Razorpay first via fetchCapturedPaymentId; a captured payment recovers
 * the order through the same markRazorpayOrderPaid path /verify and the
 * webhook use, instead of being cancelled. A failed Razorpay check skips
 * that order for this run (never cancels on an inconclusive check) — the
 * next run retries it. Also appends to `adminNotes` instead of
 * overwriting it, so a note an admin added in the meantime survives.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;
// Keeps one run's Razorpay round trips (and its DB work) bounded well
// inside the function's execution budget — the next run (every 15 min,
// per vercel.json) picks up anything left over.
const MAX_CANDIDATES_PER_RUN = 50;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  const candidates = await db.order.findMany({
    where: {
      status: "PENDING_PAYMENT",
      paymentMethod: "RAZORPAY",
      razorpayPaymentId: null,
      createdAt: { lt: cutoff },
    },
    include: { items: true, appliedDiscount: true },
    take: MAX_CANDIDATES_PER_RUN,
  });

  let cancelled = 0;
  let recovered = 0;

  for (const order of candidates) {
    let capturedPaymentId: string | null = null;
    if (order.razorpayOrderId) {
      try {
        capturedPaymentId = await fetchCapturedPaymentId(order.razorpayOrderId);
      } catch (error) {
        // The Razorpay check itself failed (network, rate limit, etc.) —
        // never fall back to cancelling on an inconclusive check. Skip
        // this order; the next run tries again.
        console.error(`[cron/cancel-stale-orders] Razorpay check failed for ${order.number}`, error);
        continue;
      }
    }

    if (capturedPaymentId) {
      const { won } = await db.$transaction((tx) => markRazorpayOrderPaid(tx, order, capturedPaymentId!));
      if (won) recovered += 1;
      continue;
    }

    const result = await db.order.updateMany({
      // Conditional, not a blind write: a concurrent /verify call or
      // webhook delivery for this same order may have just won the PAID
      // transition (or the stale-order window may have moved on) between
      // the query above and here.
      where: { id: order.id, status: "PENDING_PAYMENT", razorpayPaymentId: null },
      data: {
        status: "CANCELLED",
        // F-334: cancelledAt — see status-transitions.ts's
        // orderStatusTimestampField, the single source of truth every
        // other status-writing call site also follows.
        cancelledAt: new Date(),
        adminNotes: [order.adminNotes, "Auto-cancelled: Razorpay payment not completed within 30 minutes"]
          .filter(Boolean)
          .join("\n"),
      },
    });
    cancelled += result.count;
  }

  return NextResponse.json({ ok: true, cancelled, recovered });
}

export async function GET(request: Request) {
  return POST(request);
}
