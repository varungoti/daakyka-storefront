import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { intervalRunKey, runWithCronClaim } from "@/lib/cron/idempotency";
import { drainEmailOutbox } from "@/lib/engagement/outbox";

/**
 * F7 fix (docs/audit-2026-09-19/correctness.md): retry path for the
 * transactional-email outbox (src/lib/engagement/outbox.ts). Runs every 15
 * minutes per vercel.json — matches cancel-stale-orders' cadence, frequent
 * enough that a customer isn't waiting long for a queued order/verify/
 * reset email once Brevo is actually configured, without hammering the
 * provider while it's down.
 *
 * Idempotency is two layers deep, same "belt and suspenders" the module
 * doc comment on claimCronRun describes:
 *  1. claimCronRun below guards a duplicate invocation of the same
 *     scheduled tick (a Vercel retry, a manual re-curl) via intervalRunKey
 *     — the 15-minute-bucketed analogue of dailyRunKey, since this job
 *     runs more than once a day unlike campaigns/reports/journeys.
 *  2. drainEmailOutbox() itself claims each row it processes (lockedAt,
 *     mirroring journey-engine.ts's claimEnrollment) so two overlapping
 *     runs can never send the same message twice even if (1) were ever
 *     bypassed.
 *
 * Never overrides drainEmailOutbox's injectable sendFn — that seam exists
 * for tests only (see src/lib/engagement/outbox.test.ts); production
 * always uses the real Brevo-backed sendEmail().
 */
const SCHEDULE_WINDOW_MINUTES = 15;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // F-277: a drain that throws gives its claim back (see runWithCronClaim).
  const outcome = await runWithCronClaim(
    "drain-email-outbox",
    intervalRunKey(SCHEDULE_WINDOW_MINUTES),
    () => drainEmailOutbox(),
  );
  if (!outcome.claimed) {
    return NextResponse.json({ ok: true, alreadyRan: true });
  }

  return NextResponse.json({ ok: true, ...outcome.result });
}

export async function GET(request: Request) {
  return POST(request);
}
