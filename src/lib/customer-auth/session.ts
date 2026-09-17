import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-auth/constants";
import { shouldUseSecureSessionCookie } from "@/lib/auth/session-cookie";
import { db } from "@/lib/db";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// 30-day fixed expiry, re-issued on login only (not a sliding/refresh-on-
// activity window). The admin session (src/lib/auth/session.ts) doesn't
// refresh on activity either, and building a true sliding expiry would mean
// mutating cookies from Server Components — which Next.js does not support
// (cookies() can only be set from a Route Handler or Server Function, see
// node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md).
// A customer who stays logged in for 30 days without any auth-required
// action (login, password reset, etc.) will need to log in again; this is
// documented as a deliberate simplification for D1.
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Distinct audience claim so a customer JWT can never be replayed against
// admin routes (or vice versa) even though both use jose/HS256 — a customer
// token verifies fine against AUTH_SECRET but jwtVerify() below rejects it
// unless `aud` also matches "customer".
const CUSTOMER_JWT_AUDIENCE = "customer";

export interface CustomerSessionUser {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
}

export async function createCustomerSession(customer: {
  id: string;
  email: string;
  name: string;
  sessionVersion: number;
}): Promise<void> {
  const token = await new SignJWT({
    sub: customer.id,
    email: customer.email,
    name: customer.name,
    sv: customer.sessionVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(CUSTOMER_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: shouldUseSecureSessionCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function destroyCustomerSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CUSTOMER_SESSION_COOKIE);
}

export async function getCustomerSession(): Promise<CustomerSessionUser | null> {
  let token: string | undefined;
  try {
    const cookieStore = await cookies();
    token = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
  } catch {
    // `cookies()` throws when called outside a Next.js request scope (a
    // route handler invoked directly from a unit/integration test, or a
    // script). Mirrors the admin session's fix: fail closed to
    // unauthenticated rather than throwing.
    return null;
  }
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      audience: CUSTOMER_JWT_AUDIENCE,
    });
    const customerId = payload.sub;
    const tokenSessionVersion = payload.sv;
    if (!customerId || typeof tokenSessionVersion !== "number") return null;

    const customer = await db.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        email: true,
        name: true,
        active: true,
        sessionVersion: true,
        emailVerifiedAt: true,
      },
    });

    if (!customer || !customer.active) return null;

    // sessionVersion revocation: bumped on password reset (and available
    // for any other "log out everywhere" action). A token minted before
    // the bump carries the old version and is rejected here even though
    // its signature and expiry are still valid — this is what makes
    // "invalidate all sessions" actually work instead of just being a
    // label on an unused column.
    if (customer.sessionVersion !== tokenSessionVersion) return null;

    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      emailVerifiedAt: customer.emailVerifiedAt,
    };
  } catch {
    return null;
  }
}

export async function requireCustomerSession(): Promise<CustomerSessionUser> {
  const session = await getCustomerSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}
