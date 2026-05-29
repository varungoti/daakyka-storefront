import { NextResponse } from "next/server";
import { authorizeCron } from "@/lib/cron/authorize";
import { processDueEnrollments } from "@/lib/engagement/journey-engine";

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await processDueEnrollments();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(request: Request) {
  return POST(request);
}
