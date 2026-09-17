import { ADMIN_SESSION_COOKIE } from "@/lib/auth/constants";
import type { AdminRole } from "@/generated/prisma/client";
import { shouldUseSecureSessionCookie } from "@/lib/auth/session-cookie";
import { db } from "@/lib/db";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

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
 */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const userId = payload.sub;
    const tokenSessionVersion = payload.sv;
    if (!userId || typeof tokenSessionVersion !== "number") return null;

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        sessionVersion: true,
      },
    });

    if (!user || !user.active) return null;

    // sessionVersion revocation (v1 2.3): bumped whenever an admin's
    // access should be invalidated everywhere at once (deactivation, role
    // change — see src/app/api/admin/users/[id]/route.ts). A token minted
    // before the bump carries the old version and is rejected here even
    // though its signature and expiry are still valid, which is what
    // makes "log out everywhere" actually revoke existing sessions
    // instead of merely relying on the 7-day expiry. Mirrors
    // src/lib/customer-auth/session.ts's identical pattern.
    if (user.sessionVersion !== tokenSessionVersion) return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionUser | null> {
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
    return null;
  }
  if (!token) return null;

  return verifySessionToken(token);
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}
