import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { db } from "@/lib/db";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { segmentSchema } from "@/lib/validation/schemas";

export async function GET() {
  const { error } = await requireAdminPermission("engagement:manage");
  if (error) return error;
  const segments = await db.customerSegment.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(segments);
}

export async function POST(request: Request) {
  const { session, error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = segmentSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  const segment = await db.customerSegment.create({
    data: {
      ...parsed.data,
      criteria: JSON.stringify(parsed.data.criteria ?? {}),
    },
  });

  await logAuditEvent({
    userId: session!.id,
    action: "create",
    entity: "customer_segment",
    entityId: segment.id,
  });

  return NextResponse.json(segment, { status: 201 });
}
