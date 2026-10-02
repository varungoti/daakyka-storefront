import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { intervalRunKey, runWithCronClaim } from "@/lib/cron/idempotency";
import { processDueScheduledCampaigns } from "@/lib/engagement/campaign-dispatcher";

// F-279 fix: runs every 15 minutes per vercel.json ("*/15 * * * *") — a
// once-a-day cron meant a campaign too large to finish in one run's time
// budget (see campaign-dispatcher.ts's DISPATCH_TIME_BUDGET_MS) only ever
// resumed once a day, adding roughly a full extra day per timed-out run
// instead of picking back up within minutes. intervalRunKey(15) is an
// additional guard on top of authorizeCron so a duplicate Vercel invocation
// (or a manual retry) within the same 15-minute window short-circuits
// instead of re-dispatching every due campaign a second time.
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // F-277: a run that throws gives its claim back (see runWithCronClaim),
  // so the next 15-minute tick or a manual re-run isn't told "alreadyRan".
  const outcome = await runWithCronClaim("campaigns", intervalRunKey(15), () => processDueScheduledCampaigns());
  if (!outcome.claimed) {
    return NextResponse.json({ ok: true, alreadyRan: true, processed: 0, results: [] });
  }

  return NextResponse.json({ ok: true, ...outcome.result });
}

export async function GET(request: Request) {
  return POST(request);
}
