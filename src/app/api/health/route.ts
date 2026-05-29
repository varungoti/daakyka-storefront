import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getIntegrationStatuses } from "@/lib/integrations/status";
import { getProductSource } from "@/lib/products/index";

export async function GET() {
  try {
    await db.user.count();

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      catalog: getProductSource(),
      integrations: getIntegrationStatuses().map((item) => ({
        provider: item.provider,
        status: item.status,
      })),
    });
  } catch {
    return NextResponse.json(
      { status: "error", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }
}
