import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { resetUserPassword, UserNotFoundError } from "@/lib/auth/user-admin";
import { createSession } from "@/lib/auth/session";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Admin-triggered password reset: generates a new temp password (see
 * src/lib/auth/user-admin.ts / src/lib/auth/temp-password.ts), hashes it
 * into User.passwordHash, and returns it once. Also bumps sessionVersion
 * so any session already issued to this user is invalidated immediately
 * (same v1 2.3 revocation the PATCH route uses for role/active changes).
 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("users:manage");
  if (error) return error;

  const { id } = await params;

  try {
    const result = await resetUserPassword(id, session!.id);

    if (id === session!.id) {
      // F-159: resetting your own password bumps sessionVersion above,
      // which would otherwise reject the session cookie already on this
      // request on its very next use and sign the caller out (via
      // getSession()'s revocation check in src/lib/auth/session.ts)
      // before they ever see the new temp password. Reissue the cookie
      // here, in the same response, with the bumped version so the
      // caller stays signed in. Other users' sessions are unaffected and
      // still get revoked as before.
      await createSession(
        { id: result.user.id, email: result.user.email, name: result.user.name, role: result.role },
        result.sessionVersion,
      );
    }

    return NextResponse.json({ user: result.user, tempPassword: result.tempPassword });
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    throw err;
  }
}
