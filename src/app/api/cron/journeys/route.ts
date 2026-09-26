import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { claimCronRun, intervalRunKey } from "@/lib/cron/idempotency";
import { processDueEnrollments } from "@/lib/engagement/journey-engine";

// F-073/F-079/F-275 fix: runs every 15 minutes per vercel.json
// ("*/15 * * * *") — this used to be a once-a-day cron ("0 9 * * *"),
// which by itself capped every journey step's real-world delay at roughly
// 24h (a "+1h" cart reminder went out up to a day late) and, combined with
// the platform's per-run time budget, capped total daily throughput at
// however many steps fit in that one run. See cron/campaigns/route.ts for
// why the CronRun guard is additional to (not a replacement for)
// authorizeCron.
//
// F-275 fix: also declared in vercel.json's functions block, matching the
// hermes cron's existing pattern — the route segment config is Next's own
// mechanism (see node_modules/next/dist/docs/.../maxDuration.md), kept in
// step with the deployment platform's own limit rather than the previous
// (much lower) implicit default.
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // F-079 fix: dailyRunKey() would only let ONE of these */15 invocations a
  // day actually do anything (every later one that same day would see the
  // same key already claimed and short-circuit) — intervalRunKey(15) gives
  // each 15-minute window its own key, matching the schedule.
  const { claimed } = await claimCronRun("journeys", intervalRunKey(15));
  if (!claimed) {
    return NextResponse.json({ ok: true, alreadyRan: true, processed: 0 });
  }

  const result = await processDueEnrollments();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return POST(request);
}
