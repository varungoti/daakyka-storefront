import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import {
  deleteUser,
  LastSuperAdminError,
  UserDeleteBlockedError,
  UserNotFoundError,
  UserSelfActionBlockedError,
} from "@/lib/auth/user-admin";
import {
  buildUserUpdateData,
  isSelfRoleChangeBlocked,
  wouldRemoveLastSuperAdmin,
} from "@/lib/auth/user-updates";
import { readJsonBody } from "@/lib/security/parse-json-body";

interface RouteParams {
  params: Promise<{ id: string }>;
}

function isRecordNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
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

  if (isSelfRoleChangeBlocked(id, session!.id, existing.role, parsed.data.role)) {
    return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
  }

  const otherActiveSuperAdminCount = await db.user.count({
    where: { role: "SUPER_ADMIN", active: true, id: { not: id } },
  });
  if (wouldRemoveLastSuperAdmin(existing, parsed.data, otherActiveSuperAdminCount)) {
    return NextResponse.json(
      { error: "At least one active SUPER_ADMIN must remain" },
      { status: 400 },
    );
  }

  // sessionVersion revocation (v1 2.3): deactivating a user or changing
  // their role invalidates every session already issued to them, so a
  // demoted/deactivated admin can't keep using a cookie minted before the
  // change until it naturally expires (see src/lib/auth/session.ts's
  // getSession(), which rejects a JWT whose embedded `sv` no longer
  // matches the User row). Decision logic lives in
  // src/lib/auth/user-updates.ts so it can be unit-tested directly.
  const { data: updateData } = buildUserUpdateData(existing, parsed.data);

  try {
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
  } catch (err) {
    if (isRecordNotFound(err)) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    throw err;
  }
}

/**
 * Hard delete — genuinely appropriate only for a user with zero
 * attribution history (e.g. an invited account that was never used).
 * Every FK from User (AuditLog.userId, Product.createdById,
 * MediaAsset.createdById, Review.moderatedById, SiteSetting.updatedById)
 * is `onDelete: SetNull` in prisma/schema.prisma, so the database itself
 * would happily null them out and let the delete through — but silently
 * erasing "who did this" from history is a product decision, not a DB
 * constraint, so we block it explicitly instead and point the caller at
 * deactivation (PATCH {active:false}) for any user with real activity.
 */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("users:manage");
  if (error) return error;

  const { id } = await params;

  try {
    await deleteUser(id, session!.id);
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof UserNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (err instanceof UserSelfActionBlockedError || err instanceof LastSuperAdminError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof UserDeleteBlockedError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
