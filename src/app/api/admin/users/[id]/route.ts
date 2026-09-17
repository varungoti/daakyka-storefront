import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { buildUserUpdateData } from "@/lib/auth/user-updates";
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

  const existing = await db.user.findUnique({
    where: { id },
    select: { active: true, role: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // sessionVersion revocation (v1 2.3): deactivating a user or changing
  // their role invalidates every session already issued to them, so a
  // demoted/deactivated admin can't keep using a cookie minted before the
  // change until it naturally expires (see src/lib/auth/session.ts's
  // getSession(), which rejects a JWT whose embedded `sv` no longer
  // matches the User row). Decision logic lives in
  // src/lib/auth/user-updates.ts so it can be unit-tested directly.
  const { data: updateData } = buildUserUpdateData(existing, parsed.data);

  const user = await db.user.update({
    where: { id },
    data: updateData,
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
