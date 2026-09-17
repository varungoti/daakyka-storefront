import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { createSegment, listSegmentsForAdmin, SegmentSlugConflictError } from "@/lib/engagement/segments";
import { segmentSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("engagement:manage");
  if (error) return error;
  const segments = await listSegmentsForAdmin();
  return NextResponse.json(segments);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = segmentSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const segment = await createSegment(parsed.data, session!.id);
    return NextResponse.json(segment, { status: 201 });
  } catch (err) {
    if (err instanceof SegmentSlugConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
