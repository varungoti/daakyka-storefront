import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authorizeCron } from "@/lib/cron/authorize";

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
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  const result = await db.order.updateMany({
    where: {
      status: "PENDING_PAYMENT",
      paymentMethod: "RAZORPAY",
      razorpayPaymentId: null,
      createdAt: { lt: cutoff },
    },
    data: {
      status: "CANCELLED",
      adminNotes: "Auto-cancelled: Razorpay payment not completed within 30 minutes",
    },
  });

  return NextResponse.json({ ok: true, cancelled: result.count });
}

export async function GET(request: Request) {
  return POST(request);
}
