import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { createSizeChart, listSizeChartsForAdmin, sizeChartInputSchema } from "@/lib/catalog/size-charts";

export async function GET() {
  const { error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const sizeCharts = await listSizeChartsForAdmin();
  return NextResponse.json({ sizeCharts });
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = sizeChartInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  const sizeChart = await createSizeChart(parsed.data, session.id);
  return NextResponse.json({ sizeChart }, { status: 201 });
}
