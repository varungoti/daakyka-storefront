import { hasPermission, type Permission } from "@/lib/auth/rbac";
import { getSessionResult } from "@/lib/auth/session";

/**
 * F-061: the session half of `requireAdminPermission` below, with no
 * permission check — for a route whose authorization isn't a single fixed
 * permission (or fixed set of permissions), e.g. PATCH
 * /api/admin/settings/[key], which needs a *different* permission per key
 * (see src/lib/settings/permissions.ts's settingPermissions). Callers run
 * their own `hasPermission(session.role, ...)` check against the returned
 * session and translate a failure to a 403 themselves.
 */
export async function requireAdminSession() {
  const result = await getSessionResult();
  // F-369: a DB outage while checking the session is not the same thing
  // as "not logged in" — surface it as a distinct, clean 503 instead of a
  // 401 that looks exactly like an expired/invalid session.
  if (result.status === "db-unavailable") {
    return {
      session: null,
      error: Response.json(
        { error: "Service temporarily unavailable. Please try again shortly." },
        { status: 503 },
      ),
    };
  }
  if (result.status !== "ok") {
    return { session: null, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session: result.user, error: null };
}

/**
 * F-268: `permission` accepts an array — "allowed if the role has ANY of
 * these" — mirroring src/components/admin/admin-shell.tsx's
 * `canSeeNavItem`, which already uses the same "any of" shape for nav
 * items reachable by more than one permission (e.g. the Marketing hub
 * link). Needed for routes like /api/admin/notifications/mark-all-read,
 * whose page now opens for several different permissions at once (see
 * src/lib/admin/notifications-access.ts) rather than one.
 */
export async function requireAdminPermission(permission: Permission | Permission[]) {
  const { session, error } = await requireAdminSession();
  if (error) return { session: null, error };
  const allowed = Array.isArray(permission)
    ? permission.some((p) => hasPermission(session.role, p))
    : hasPermission(session.role, permission);
  if (!allowed) {
    return { session: null, error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, error: null };
}
