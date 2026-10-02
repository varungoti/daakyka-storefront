import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import {
  deleteUser,
  LastSuperAdminError,
  updateAdminUser,
  UserDeleteBlockedError,
  UserNotFoundError,
  UserSelfActionBlockedError,
} from "@/lib/auth/user-admin";
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

  const parsed = userUpdateSchema.safeParse(bodyResult.data);
  if (!parsed.success) {
    // F-172: this used to send a bare "Validation failed" with no `issues`,
    // so the admin UI had nothing to say about *which* field was wrong.
    return NextResponse.json({ error: "Validation failed", issues: parsed.error.issues }, { status: 400 });
  }

  // The rules (no self-deactivation / self-role-change, the last active
  // SUPER_ADMIN must remain — checked atomically) and the sessionVersion
  // revocation decision live in updateAdminUser (src/lib/auth/user-admin.ts)
  // so they're testable without a request scope.
  try {
    const user = await updateAdminUser(id, parsed.data, session!.id);
    return NextResponse.json(user);
  } catch (err) {
    if (err instanceof UserNotFoundError || isRecordNotFound(err)) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (err instanceof UserSelfActionBlockedError || err instanceof LastSuperAdminError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
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
