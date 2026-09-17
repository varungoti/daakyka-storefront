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
