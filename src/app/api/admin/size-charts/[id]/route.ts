import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  deleteSizeChart,
  getSizeChartForAdmin,
  sizeChartInputSchema,
  SizeChartInUseError,
  SizeChartNotFoundError,
  updateSizeChart,
} from "@/lib/catalog/size-charts";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const { id } = await params;
  try {
    const sizeChart = await getSizeChartForAdmin(id);
    return NextResponse.json({ sizeChart });
  } catch (err) {
    if (err instanceof SizeChartNotFoundError) {
      return NextResponse.json({ error: "Size chart not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = sizeChartInputSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const sizeChart = await updateSizeChart(id, parsed.data, session.id);
    return NextResponse.json({ sizeChart });
  } catch (err) {
    if (err instanceof SizeChartNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Size chart not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("categories:manage");
  if (error) return error;

  const { id } = await params;
  try {
    await deleteSizeChart(id, session.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof SizeChartNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Size chart not found" }, { status: 404 });
    }
    if (err instanceof SizeChartInUseError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
