import { redirect } from "next/navigation";
import { hasPermission, type Permission } from "@/lib/auth/rbac";
import { getSession, type SessionUser } from "@/lib/auth/session";

/**
 * F-062: `getSession()`'s DB-backed check (is the admin still `active`,
 * has their `sessionVersion` been bumped by a deactivation/role change —
 * see src/lib/auth/session.ts) previously ran only in the (panel) layout,
 * not on every page. Next only re-renders the *page* segment on a
 * client-side (RSC) navigation — the layout above it does not re-run —
 * so a small set of pages that never called `getSession()` themselves
 * (the dashboard, and the blog editor) kept serving fresh data to a
 * since-deactivated or since-demoted admin whose tab was already open,
 * for up to the token's 7-day life, with no re-login required.
 *
 * Call this at the top of every admin panel `page.tsx`, before any query,
 * so both the session's validity and the page's own permission are
 * re-checked on *every* request — soft-navigated or not. This is exactly
 * what most (panel) pages already do inline (see e.g.
 * src/app/admin/(panel)/audit-logs/page.tsx); this just gives that same
 * two-line pattern a name so it's easy to grep for and to statically
 * verify every page has it (see admin-routes-guarded.test.ts).
 */
export async function requireAdminPage(permission: Permission): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    redirect("/admin/login");
  }
  if (!hasPermission(session.role, permission)) {
    redirect("/admin/dashboard");
  }
  return session;
}
