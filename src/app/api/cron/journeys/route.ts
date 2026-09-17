import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { claimCronRun, dailyRunKey } from "@/lib/cron/idempotency";
import { processDueEnrollments } from "@/lib/engagement/journey-engine";

// Runs once/day per vercel.json ("0 9 * * *"); see cron/campaigns/route.ts
// for why the CronRun guard is additional to (not a replacement for)
// authorizeCron.
export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { claimed } = await claimCronRun("journeys", dailyRunKey());
  if (!claimed) {
    return NextResponse.json({ ok: true, alreadyRan: true, processed: 0 });
  }

  const result = await processDueEnrollments();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return POST(request);
}
