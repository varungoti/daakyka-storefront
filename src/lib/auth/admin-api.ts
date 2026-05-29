import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";

export async function requireAdminPermission(permission: Parameters<typeof hasPermission>[1]) {
  const session = await getSession();
  if (!session) {
    return { session: null, error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!hasPermission(session.role, permission)) {
    return { session: null, error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, error: null };
}
