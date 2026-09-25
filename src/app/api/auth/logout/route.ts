import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { destroySession, getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function POST() {
  const session = await getSession();
  if (session) {
    await logAuditEvent({
      userId: session.id,
      action: "logout",
      entity: "user",
      entityId: session.id,
    });

    // F-081: logout previously only cleared this device's cookie — the
    // JWT itself stayed valid (verifySessionToken only checks
    // sessionVersion, not any revocation list) for the rest of its 7-day
    // lifetime, so a copied/leaked token kept working after "logout".
    // Bumping sessionVersion here reuses the same revocation check
    // deactivation/role-change already rely on (src/app/api/admin/users/[id]/route.ts)
    // and signs this admin out everywhere, which is the safer default
    // for a small admin team and a security-relevant action.
    await db.user
      .update({ where: { id: session.id }, data: { sessionVersion: { increment: 1 } } })
      .catch((error) => {
        // Best-effort: if the DB is unreachable, still clear the cookie
        // below so this device logs out; the token just keeps working
        // elsewhere until it expires naturally, same as before this fix.
        console.error("[auth/logout] failed to revoke session server-side", error);
      });
  }

  await destroySession();
  return NextResponse.json({ success: true });
}
