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
