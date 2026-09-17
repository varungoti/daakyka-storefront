import { Prisma, type AdminRole, type User } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";
import { hashPassword } from "@/lib/auth/password";
import { generateTempPassword } from "@/lib/auth/temp-password";
import { db } from "@/lib/db";

/**
 * Service layer for admin user create/invite, password reset, and delete —
 * split out from src/app/api/admin/users/**\/route.ts (same convention as
 * src/lib/catalog/categories.ts) so the business rules are directly
 * unit/integration-testable without needing a real Next.js request scope
 * for requireAdminPermission()'s getSession() (see tests/integration/
 * catalog-admin.test.ts's header comment for that constraint).
 *
 * See src/lib/auth/temp-password.ts for why invite/reset return a one-time
 * temp password instead of an email-based token flow.
 */

export interface InviteUserInput {
  name: string;
  email: string;
  role: AdminRole;
}

export interface InviteUserResult {
  user: Pick<User, "id" | "email" | "name" | "role" | "active" | "createdAt">;
  tempPassword: string;
}

export class UserEmailConflictError extends Error {
  constructor(email: string) {
    super(`A user with email "${email}" already exists`);
    this.name = "UserEmailConflictError";
  }
}

export class UserNotFoundError extends Error {
  constructor(id: string) {
    super(`User ${id} not found`);
    this.name = "UserNotFoundError";
  }
}

export class LastSuperAdminError extends Error {
  constructor() {
    super("At least one active SUPER_ADMIN must remain");
    this.name = "LastSuperAdminError";
  }
}

export class UserSelfActionBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserSelfActionBlockedError";
  }
}

export class UserDeleteBlockedError extends Error {
  constructor() {
    super(
      "This user has activity history (audit log, catalog, or moderation records) and can't be permanently deleted — deactivate them instead (PATCH active: false).",
    );
    this.name = "UserDeleteBlockedError";
  }
}

export async function inviteUser(input: InviteUserInput, actingUserId: string): Promise<InviteUserResult> {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    const user = await db.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        role: input.role,
        passwordHash,
        active: true,
      },
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    });

    await logAuditEvent({
      userId: actingUserId,
      action: "create",
      entity: "user",
      entityId: user.id,
      metadata: { email: user.email, role: user.role },
    });

    return { user, tempPassword };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new UserEmailConflictError(input.email);
    }
    throw err;
  }
}

export async function resetUserPassword(
  id: string,
  actingUserId: string,
): Promise<{ user: Pick<User, "id" | "email" | "name">; tempPassword: string }> {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    const user = await db.user.update({
      where: { id },
      data: { passwordHash, sessionVersion: { increment: 1 } },
      select: { id: true, email: true, name: true },
    });

    await logAuditEvent({
      userId: actingUserId,
      action: "update",
      entity: "user",
      entityId: id,
      metadata: { passwordReset: true },
    });

    return { user, tempPassword };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new UserNotFoundError(id);
    }
    throw err;
  }
}

/**
 * Permanently deletes a user. Every FK from User (AuditLog.userId,
 * Product.createdById, MediaAsset.createdById, Review.moderatedById,
 * SiteSetting.updatedById) is `onDelete: SetNull` in prisma/schema.prisma,
 * so the database itself would let this through even for a user with a
 * long history — but silently erasing "who did this" from audit/catalog
 * history is a product decision, not a DB constraint, so we block it
 * explicitly (UserDeleteBlockedError) unless the user has zero footprint,
 * and point the caller at deactivation instead.
 */
export async function deleteUser(id: string, actingUserId: string): Promise<void> {
  if (id === actingUserId) {
    throw new UserSelfActionBlockedError("Cannot delete your own account");
  }

  const existing = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, active: true },
  });
  if (!existing) throw new UserNotFoundError(id);

  if (existing.role === "SUPER_ADMIN" && existing.active) {
    const otherActiveSuperAdminCount = await db.user.count({
      where: { role: "SUPER_ADMIN", active: true, id: { not: id } },
    });
    if (otherActiveSuperAdminCount === 0) {
      throw new LastSuperAdminError();
    }
  }

  const [auditCount, productCount, mediaCount, reviewCount, settingCount] = await Promise.all([
    db.auditLog.count({ where: { userId: id } }),
    db.product.count({ where: { createdById: id } }),
    db.mediaAsset.count({ where: { createdById: id } }),
    db.review.count({ where: { moderatedById: id } }),
    db.siteSetting.count({ where: { updatedById: id } }),
  ]);
  if (auditCount + productCount + mediaCount + reviewCount + settingCount > 0) {
    throw new UserDeleteBlockedError();
  }

  try {
    await db.user.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new UserNotFoundError(id);
    }
    throw err;
  }

  await logAuditEvent({
    userId: actingUserId,
    action: "delete",
    entity: "user",
    entityId: id,
    metadata: { email: existing.email },
  });
}
