import { hasPermission } from "@/lib/auth/rbac";
import { getSessionResult } from "@/lib/auth/session";

export async function requireAdminPermission(permission: Parameters<typeof hasPermission>[1]) {
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
  if (!hasPermission(result.user.role, permission)) {
    return { session: null, error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session: result.user, error: null };
}
