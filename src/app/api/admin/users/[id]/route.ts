import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { readJsonBody } from "@/lib/security/parse-json-body";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("users:manage");
  if (error) return error;

  const { id } = await params;
  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;

  const { userUpdateSchema } = await import("@/lib/validation/schemas");
  const { logAuditEvent } = await import("@/lib/auth/audit");
  const { db } = await import("@/lib/db");

  const parsed = userUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 400 });
  }

  if (id === session!.id && !parsed.data.active) {
    return NextResponse.json({ error: "Cannot deactivate your own account" }, { status: 400 });
  }

  const user = await db.user.update({
    where: { id },
    data: parsed.data,
    select: { id: true, email: true, name: true, role: true, active: true },
  });

  await logAuditEvent({
    userId: session!.id,
    action: "update",
    entity: "user",
    entityId: id,
    metadata: parsed.data,
  });

  return NextResponse.json(user);
}
