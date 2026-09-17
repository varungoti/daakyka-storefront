import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { claimCronRun, dailyRunKey } from "@/lib/cron/idempotency";
import { processDueScheduledCampaigns } from "@/lib/engagement/campaign-dispatcher";

// Runs once/day per vercel.json ("0 10 * * *") — a calendar-date runKey is
// an additional guard on top of authorizeCron so a duplicate Vercel
// invocation (or a manual retry) in the same day's window short-circuits
// instead of re-dispatching every due campaign a second time.
export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { claimed } = await claimCronRun("campaigns", dailyRunKey());
  if (!claimed) {
    return NextResponse.json({ ok: true, alreadyRan: true, processed: 0, results: [] });
  }

  const result = await processDueScheduledCampaigns();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return POST(request);
}
