import { NextResponse } from "next/server";
import { getHermesRuntimeInfo } from "@/lib/hermes/runtime/router";

export const runtime = "nodejs";

export async function GET() {
  const info = getHermesRuntimeInfo();
  return NextResponse.json({
    ok: true,
    ...info,
    timestamp: new Date().toISOString(),
  });
}
