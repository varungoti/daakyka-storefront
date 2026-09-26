import { NextResponse } from "next/server";
import { destroyCustomerSession, getCustomerSession, revokeCustomerSessions } from "@/lib/customer-auth/session";

/**
 * F-138: this used to only delete the cookie, leaving a copied/leaked
 * token valid for its full 30-day life. Bumping sessionVersion first
 * revokes it server-side (see revokeCustomerSessions's doc comment) —
 * best-effort: if the session is already invalid (no cookie, expired,
 * already revoked), getCustomerSession() returns null and there's
 * nothing to revoke, so this still just clears the cookie as before.
 */
export async function POST() {
  const session = await getCustomerSession();
  if (session) {
    try {
      await revokeCustomerSessions(session.id);
    } catch {
      // Best-effort: a DB hiccup here must not stop the user from being
      // able to sign out — the cookie is still cleared below either way.
    }
  }
  await destroyCustomerSession();
  return NextResponse.json({ ok: true });
}
