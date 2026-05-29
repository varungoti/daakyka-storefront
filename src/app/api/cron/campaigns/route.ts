import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { processDueScheduledCampaigns } from "@/lib/engagement/campaign-dispatcher";

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processDueScheduledCampaigns();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return POST(request);
}
