import { Prisma, type AdminRole, type User } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";
import { diffFields } from "@/lib/auth/audit-diff";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { isLocked, recordFailedLogin } from "@/lib/auth/lockout";
import { isInsecureSeedPassword } from "@/lib/auth/seed-defaults";
import { generateTempPassword } from "@/lib/auth/temp-password";
import {
  buildUserUpdateData,
  isSelfRoleChangeBlocked,
  wouldRemoveLastSuperAdmin,
  type UserUpdateInput,
} from "@/lib/auth/user-updates";
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

/**
 * F-057: distinguishes "wrong current password" from "the account is
 * currently locked" for changeOwnPassword's caller (the route), the same
 * way src/lib/customer-auth/verify-current-password.ts does for the
 * customer-facing equivalent (F-325) — never a bare boolean, since the
 * route needs to pick between a 400 and a 423.
 */
export class CurrentPasswordIncorrectError extends Error {
  constructor() {
    super("Current password is incorrect");
    this.name = "CurrentPasswordIncorrectError";
  }
}

export class AccountLockedForPasswordChangeError extends Error {
  constructor() {
    super("Too many incorrect attempts. Try again later.");
    this.name = "AccountLockedForPasswordChangeError";
  }
}

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
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
        // F-057: the invite copy already tells the new admin to "sign in
        // and change it as soon as possible" — mustChangePassword is what
        // actually enforces that (see the (panel) layout's redirect),
        // instead of the temp password quietly becoming their permanent
        // credential.
        mustChangePassword: true,
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

export type UpdatedAdminUser = Pick<User, "id" | "email" | "name" | "role" | "active">;

/**
 * PATCH /api/admin/users/[id]'s business rules — name/role/active edits —
 * split out of the route so they're testable without a request scope (see
 * the file comment above).
 *
 * F-172: the "at least one active SUPER_ADMIN must remain" rule used to be
 * count-then-update outside any transaction, so two Super Admins demoting
 * each other at the same moment both counted "one other Super Admin left",
 * both passed, and none were left. Now, when an update would take an active
 * SUPER_ADMIN out of that state, the check and the write run in one
 * transaction that first row-locks every active SUPER_ADMIN
 * (`SELECT ... FOR NO KEY UPDATE`): the second of two racing changes waits
 * for the first to commit, then counts against what's actually committed and
 * is refused. NO KEY UPDATE (not plain FOR UPDATE) because that's the mode an
 * ordinary `UPDATE` takes, so racing changes still exclude each other, while
 * it doesn't block the foreign-key check every audit-log insert makes against
 * its acting user. Unrelated edits (a name change, a non-admin's role) take
 * no lock.
 */
export async function updateAdminUser(
  id: string,
  input: UserUpdateInput,
  actingUserId: string,
): Promise<UpdatedAdminUser> {
  if (id === actingUserId && !input.active) {
    throw new UserSelfActionBlockedError("Cannot deactivate your own account");
  }

  const { user, previous } = await db.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id }, select: { active: true, role: true, name: true } });
    if (!existing) throw new UserNotFoundError(id);

    if (isSelfRoleChangeBlocked(id, actingUserId, existing.role, input.role)) {
      throw new UserSelfActionBlockedError("Cannot change your own role");
    }

    const staysActiveSuperAdmin = input.role === "SUPER_ADMIN" && input.active;
    const leavesSuperAdmin = existing.role === "SUPER_ADMIN" && existing.active && !staysActiveSuperAdmin;
    if (leavesSuperAdmin) {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "role" = 'SUPER_ADMIN' AND "active" = true FOR NO KEY UPDATE`;
      const otherActiveSuperAdminCount = await tx.user.count({
        where: { role: "SUPER_ADMIN", active: true, id: { not: id } },
      });
      if (wouldRemoveLastSuperAdmin(existing, input, otherActiveSuperAdminCount)) {
        throw new LastSuperAdminError();
      }
    }

    // sessionVersion revocation (v1 2.3): deactivating a user or changing
    // their role invalidates every session already issued to them, so a
    // demoted/deactivated admin can't keep using a cookie minted before the
    // change until it naturally expires (see src/lib/auth/session.ts).
    // Decision logic lives in src/lib/auth/user-updates.ts.
    const { data } = buildUserUpdateData(existing, input);
    const updated = await tx.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, active: true },
    });
    return { user: updated, previous: existing };
  });

  await logAuditEvent({
    userId: actingUserId,
    action: "update",
    entity: "user",
    entityId: id,
    // F-288: this used to hold only the NEW values, so a promotion to
    // SUPER_ADMIN showed the new role and nothing about what it replaced.
    metadata: {
      ...input,
      fromRole: previous.role,
      fromActive: previous.active,
      changes: diffFields(previous, user, ["name", "role", "active"]),
    },
  });

  return user;
}

export async function resetUserPassword(
  id: string,
  actingUserId: string,
): Promise<{
  user: Pick<User, "id" | "email" | "name">;
  tempPassword: string;
  role: AdminRole;
  sessionVersion: number;
}> {
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  try {
    const user = await db.user.update({
      where: { id },
      data: {
        passwordHash,
        sessionVersion: { increment: 1 },
        // F-164: an admin-triggered reset must also clear any lockout on
        // the target account. Without this, "Reset password" — the only
        // recovery path a locked-out admin is pointed at (see
        // src/app/admin/login/page.tsx) — leaves them 423'd until
        // `lockedUntil` passes on its own, even with the new password.
        // Mirrors src/app/api/account/reset-password's handling of the
        // customer-facing lockout.
        failedLoginCount: 0,
        lastFailedLoginAt: null,
        lockedUntil: null,
        // F-057: an admin-issued temp password must be changed at next
        // login, the same as a fresh invite — otherwise it can quietly
        // become the account's permanent credential.
        mustChangePassword: true,
      },
      select: { id: true, email: true, name: true, role: true, sessionVersion: true },
    });

    await logAuditEvent({
      userId: actingUserId,
      action: "update",
      entity: "user",
      entityId: id,
      metadata: { passwordReset: true },
    });

    return {
      user: { id: user.id, email: user.email, name: user.name },
      tempPassword,
      role: user.role,
      sessionVersion: user.sessionVersion,
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new UserNotFoundError(id);
    }
    throw err;
  }
}

/**
 * F-057: self-service password change — the gap that left temp passwords
 * relayed over chat, and the developer-set ADMIN_SEED_PASSWORD, as the
 * only credential an admin could ever actually use, with no way to
 * rotate it themselves. Mirrors
 * src/lib/customer-auth/verify-current-password.ts's customer-facing
 * equivalent (F-325): the same account lockout a failed *login* feeds
 * (src/lib/auth/lockout.ts) also counts a wrong currentPassword guess
 * here, so this can't be used to brute-force a stolen session's real
 * password. Callers (the route) map each thrown error to the right HTTP
 * status; nothing here touches `Response`.
 */
export async function changeOwnPassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ sessionVersion: number }> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, lockedUntil: true },
  });
  if (!user) throw new UserNotFoundError(userId);

  if (isLocked(user)) {
    throw new AccountLockedForPasswordChangeError();
  }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    const { locked } = await recordFailedLogin(userId);
    throw locked ? new AccountLockedForPasswordChangeError() : new CurrentPasswordIncorrectError();
  }

  if (newPassword === currentPassword) {
    throw new WeakPasswordError("New password must be different from your current password");
  }
  if (isInsecureSeedPassword(newPassword)) {
    throw new WeakPasswordError("That password is too weak or has been leaked — choose a stronger one");
  }

  const passwordHash = await hashPassword(newPassword);
  const updated = await db.user.update({
    where: { id: userId },
    data: {
      passwordHash,
      sessionVersion: { increment: 1 },
      mustChangePassword: false,
    },
    select: { sessionVersion: true },
  });

  await logAuditEvent({
    userId,
    action: "update",
    entity: "user",
    entityId: userId,
    // Never log either password — only that a change happened.
    metadata: { selfPasswordChange: true },
  });

  return { sessionVersion: updated.sessionVersion };
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
