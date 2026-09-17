import type { AdminRole } from "@/generated/prisma/client";

/**
 * Decides whether updating an admin User should also bump `sessionVersion`
 * (v1 2.3 revocation), and builds the Prisma `data` object for the update.
 *
 * Split out from src/app/api/admin/users/[id]/route.ts so the decision
 * logic can be unit-tested directly (the route itself requires a real
 * Next.js request scope for getSession()/cookies(), which integration
 * tests in this codebase can't fake — see tests/integration/
 * catalog-admin.test.ts's identical note on that constraint).
 *
 * Sessions are revoked whenever the update:
 *  - deactivates a currently-active user, or
 *  - changes their role.
 * A plain name change, or re-saving the same role/active values, doesn't
 * bump the version — only changes that should invalidate existing
 * sessions do.
 */
export interface ExistingUserState {
  active: boolean;
  role: AdminRole;
}

export interface UserUpdateInput {
  name: string;
  role: AdminRole;
  active: boolean;
}

export interface UserUpdateData extends UserUpdateInput {
  sessionVersion?: { increment: number };
}

export function buildUserUpdateData(
  existing: ExistingUserState,
  next: UserUpdateInput,
): { data: UserUpdateData; revokesSessions: boolean } {
  const revokesSessions = (existing.active && !next.active) || existing.role !== next.role;

  return {
    data: {
      ...next,
      ...(revokesSessions ? { sessionVersion: { increment: 1 } } : {}),
    },
    revokesSessions,
  };
}

/**
 * Two guard rules for PATCH /api/admin/users/[id] (task: admin CRUD
 * completion, "Enforce the existing 'can't demote/deactivate the last
 * SUPER_ADMIN' and 'can't change your own role' rules if they exist").
 * Neither rule existed in the codebase before this change — the route
 * already blocked self-*deactivation*, but not a self-role-change or
 * removing the last SUPER_ADMIN — so both are added here as pure,
 * unit-testable functions; the route only supplies the DB-derived count.
 */

/** An admin may still edit their own name/active flag, but changing their
 * *own* role is blocked — otherwise a SUPER_ADMIN could accidentally (or
 * a compromised session could deliberately) demote themselves out of a
 * permission they still need mid-session. */
export function isSelfRoleChangeBlocked(
  targetUserId: string,
  actingUserId: string,
  existingRole: AdminRole,
  nextRole: AdminRole,
): boolean {
  return targetUserId === actingUserId && existingRole !== nextRole;
}

/**
 * True when this update would leave zero active SUPER_ADMIN accounts:
 * the target is currently an active SUPER_ADMIN, the update would take
 * them out of that state (role change and/or deactivation), and no other
 * active SUPER_ADMIN exists to fall back on.
 *
 * `otherActiveSuperAdminCount` must be the count of *other* active
 * SUPER_ADMIN users (i.e. excluding the target row) — the route computes
 * this with `db.user.count({ where: { role: "SUPER_ADMIN", active: true,
 * id: { not: id } } })` so the pure decision here doesn't need a DB call.
 */
export function wouldRemoveLastSuperAdmin(
  existing: ExistingUserState,
  next: UserUpdateInput,
  otherActiveSuperAdminCount: number,
): boolean {
  if (existing.role !== "SUPER_ADMIN" || !existing.active) return false;
  const staysSuperAdmin = next.role === "SUPER_ADMIN" && next.active;
  if (staysSuperAdmin) return false;
  return otherActiveSuperAdminCount === 0;
}
