import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import type { AdminRole } from "@/generated/prisma/client";
import { shouldUseSecureSessionCookie } from "@/lib/auth/session-cookie";
import { db } from "@/lib/db";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  /** Read from the DB on verification; deliberately never trusted from the JWT. */
  mustChangePassword?: boolean;
}

/**
 * F-369: `verifySessionToken`/`getSession` collapse three different
 * outcomes into one `null` — a bad/expired token, an inactive/revoked
 * user, AND "the DB was unreachable while checking the session" — which
 * makes a DB blip indistinguishable from an ordinary logout, with nothing
 * in the logs to tell them apart. This richer result backs the ~90
 * existing callers' `SessionUser | null` contract unchanged (see the thin
 * wrappers below); only `requireAdminPermission` and the admin panel
 * layout — the two places deciding "log the user out" vs. "try again
 * shortly" — need to see `db-unavailable` specifically.
 */
export type SessionResult =
  | { status: "ok"; user: SessionUser }
  | { status: "unauthenticated" }
  | { status: "db-unavailable" };

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mints the signed session JWT without touching cookies — split out from
 * `createSession` so the sessionVersion-revocation logic (see
 * `verifySessionToken` below) can be exercised in tests without needing a
 * real Next.js request scope for `cookies()`.
 */
export async function signSessionToken(
  user: SessionUser,
  sessionVersion: number,
): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    sv: sessionVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());
}

export async function createSession(
  user: SessionUser,
  sessionVersion: number,
): Promise<void> {
  const token = await signSessionToken(user, sessionVersion);

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE);
}

/**
 * Verifies a raw session JWT string (signature, expiry, and the
 * sessionVersion-revocation check against the DB) without touching
 * `cookies()`. Exported so tests can exercise revocation directly — see
 * tests/integration/admin-auth.test.ts — since `getSession()` itself can
 * only be driven through cookies() inside a real Next.js request.
 *
 * F-369: the JWT check and the DB lookup are deliberately in *separate*
 * try/catch blocks. A bad/expired/tampered token is an ordinary,
 * expected "not logged in" — no log needed. A failure in the DB lookup
 * is not: it means the session might well be valid and we simply
 * couldn't check, so it's logged with context and reported as
 * `db-unavailable` instead of being silently folded into the same
 * "unauthenticated" bucket (which — before this fix — made a DB blip
 * indistinguishable from a real logout, with zero trace in the logs).
 */
export async function verifySessionTokenResult(token: string): Promise<SessionResult> {
  let userId: string | undefined;
  let tokenSessionVersion: number | undefined;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    userId = payload.sub;
    tokenSessionVersion = typeof payload.sv === "number" ? payload.sv : undefined;
  } catch {
    return { status: "unauthenticated" };
  }
  if (!userId || tokenSessionVersion === undefined) return { status: "unauthenticated" };

  let user;
  try {
    user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        sessionVersion: true,
        mustChangePassword: true,
      },
    });
  } catch (error) {
    console.error("[auth/session] DB unavailable while verifying an admin session", error);
    return { status: "db-unavailable" };
  }

  if (!user || !user.active) return { status: "unauthenticated" };

  // sessionVersion revocation (v1 2.3): bumped whenever an admin's
  // access should be invalidated everywhere at once (deactivation, role
  // change — see src/app/api/admin/users/[id]/route.ts — and logout,
  // F-081). A token minted before the bump carries the old version and
  // is rejected here even though its signature and expiry are still
  // valid, which is what makes "log out everywhere" actually revoke
  // existing sessions instead of merely relying on the 7-day expiry.
  // Mirrors src/lib/customer-auth/session.ts's identical pattern.
  if (user.sessionVersion !== tokenSessionVersion) return { status: "unauthenticated" };

  return {
    status: "ok",
    user: { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword },
  };
}

/** Thin `SessionUser | null` wrapper over {@link verifySessionTokenResult}
 * for the many existing callers (and tests/integration/admin-auth.test.ts)
 * that don't need to distinguish "invalid" from "DB unavailable". */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  const result = await verifySessionTokenResult(token);
  return result.status === "ok" ? result.user : null;
}

// F-262: wrapped in React `cache()` so the panel layout and the page it
// renders (both call this, in the same request) share one user lookup
// instead of each paying a database round trip. Scoped to a single request;
// outside a render (route handlers, tests) it simply calls through.
export const getSessionResult = cache(async function getSessionResult(): Promise<SessionResult> {
  let token: string | undefined;
  try {
    const cookieStore = await cookies();
    token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  } catch {
    // `cookies()` throws when called outside a Next.js request scope —
    // e.g. an admin route handler invoked directly in a unit/integration
    // test, or a script, rather than through an actual HTTP request. In a
    // real request this scope always exists, so this only ever changes
    // behavior in those out-of-request contexts, where "no cookies
    // available" and "no session" are equivalent: fail closed to
    // unauthenticated instead of throwing.
    return { status: "unauthenticated" };
  }
  if (!token) return { status: "unauthenticated" };

  return verifySessionTokenResult(token);
});

/** Thin `SessionUser | null` wrapper over {@link getSessionResult} — see
 * its docs. Use `getSessionResult()` directly wherever a DB outage should
 * render as "temporarily unavailable" instead of a login redirect (e.g.
 * `requireAdminPermission`, the admin panel layout). */
export async function getSession(): Promise<SessionUser | null> {
  const result = await getSessionResult();
  if (result.status !== "ok") return null;
  await enforceAdminPasswordChange(result.user);
  return result.user;
}

/** Checked on every page segment, including a client-side RSC navigation. */
export async function enforceAdminPasswordChange(user: SessionUser): Promise<void> {
  if (!user.mustChangePassword) return;
  const pathname = (await headers()).get("x-admin-pathname");
  if ((pathname === "/admin" || pathname?.startsWith("/admin/")) && pathname !== "/admin/account") {
    redirect("/admin/account?required=1");
  }
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}
