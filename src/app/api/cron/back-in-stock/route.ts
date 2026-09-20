import { NextResponse } from "next/server";
import { sweepBackInStock } from "@/lib/back-in-stock";
import { authorizeCron } from "@/lib/cron/authorize";
import { claimCronRun, intervalRunKey } from "@/lib/cron/idempotency";

/**
 * Shopify-parity gap: restock-detection sweep for back-in-stock "Notify
 * me" subscriptions — see src/lib/back-in-stock/index.ts's module doc
 * comment for why this is a cron sweep rather than a hook at each
 * stock-writing call site. Runs every 15 minutes per vercel.json, the same
 * cadence as drain-email-outbox and cancel-stale-orders — frequent enough
 * that a shopper isn't waiting long to hear a restocked item is available,
 * without a tight loop hammering the DB for what's normally a no-op scan.
 *
 * Idempotency is the same two layers as drain-email-outbox/route.ts:
 *  1. claimCronRun below guards a duplicate invocation of the same
 *     scheduled tick (a Vercel retry, a manual re-curl) via
 *     intervalRunKey.
 *  2. sweepBackInStock itself claims each subscription row it processes
 *     (a conditional `updateMany` on `notifiedAt`) so two overlapping runs
 *     can never send the same restock email twice even if (1) were ever
 *     bypassed.
 */
const SCHEDULE_WINDOW_MINUTES = 15;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { claimed } = await claimCronRun("back-in-stock", intervalRunKey(SCHEDULE_WINDOW_MINUTES));
  if (!claimed) {
    return NextResponse.json({ ok: true, alreadyRan: true });
  }

  const result = await sweepBackInStock();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return POST(request);
}
