import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import {
  deleteSegment,
  getSegmentForAdmin,
  SegmentDeleteBlockedError,
  SegmentNotFoundError,
  SegmentSlugConflictError,
  updateSegment,
} from "@/lib/engagement/segments";
import { segmentUpdateSchema } from "@/lib/validation/schemas";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const { id } = await params;
  try {
    const segment = await getSegmentForAdmin(id);
    return NextResponse.json(segment);
  } catch (err) {
    if (err instanceof SegmentNotFoundError) {
      return NextResponse.json({ error: "Segment not found" }, { status: 404 });
    }
    throw err;
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const parsed = segmentUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const segment = await updateSegment(id, parsed.data, session!.id);
    return NextResponse.json(segment);
  } catch (err) {
    if (err instanceof SegmentNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Segment not found" }, { status: 404 });
    }
    if (err instanceof SegmentSlugConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const { id } = await params;
  try {
    await deleteSegment(id, session!.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof SegmentNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "Segment not found" }, { status: 404 });
    }
    if (err instanceof SegmentDeleteBlockedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
