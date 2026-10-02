import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-auth/constants";
import { shouldUseSecureSessionCookie } from "@/lib/auth/session-cookie";
import { db } from "@/lib/db";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";

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

/** F-369: mirrors src/lib/auth/session.ts's SessionResult — see its docs. */
export type CustomerSessionResult =
  | { status: "ok"; user: CustomerSessionUser }
  | { status: "unauthenticated" }
  | { status: "db-unavailable" };

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

/**
 * F-138: Sign Out used to only delete the cookie — the JWT itself stays
 * valid (signature + expiry both still check out) for the rest of its
 * 30-day life, so a copied/leaked token kept working long after the
 * owner "signed out". Bumping `sessionVersion` is the same revocation
 * mechanism password reset already relies on (see
 * verifyCustomerSessionTokenResult's sessionVersion check above): every
 * outstanding token for this customer, on every device, stops verifying
 * immediately, not just the cookie in the browser that clicked Sign Out.
 * That's an acceptable trade-off for a small store with no per-device
 * session list to sign out selectively.
 */
export async function revokeCustomerSessions(customerId: string): Promise<void> {
  await db.customer.update({
    where: { id: customerId },
    data: { sessionVersion: { increment: 1 } },
  });
}

/**
 * Verifies a raw customer session JWT string without touching `cookies()`.
 * Split out (mirroring src/lib/auth/session.ts's verifySessionTokenResult)
 * so the DB-outage classification below is directly testable, and so the
 * JWT check and the DB lookup are in separate try/catch blocks: a DB
 * outage is logged and reported as `db-unavailable` instead of being
 * silently folded into the same "unauthenticated" bucket as a bad/expired
 * token (F-369).
 */
export async function verifyCustomerSessionTokenResult(token: string): Promise<CustomerSessionResult> {
  let customerId: string | undefined;
  let tokenSessionVersion: number | undefined;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      audience: CUSTOMER_JWT_AUDIENCE,
    });
    customerId = payload.sub;
    tokenSessionVersion = typeof payload.sv === "number" ? payload.sv : undefined;
  } catch {
    return { status: "unauthenticated" };
  }
  if (!customerId || tokenSessionVersion === undefined) return { status: "unauthenticated" };

  let customer;
  try {
    customer = await db.customer.findUnique({
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
  } catch (error) {
    console.error("[customer-auth/session] DB unavailable while verifying a customer session", error);
    return { status: "db-unavailable" };
  }

  if (!customer || !customer.active) return { status: "unauthenticated" };

  // sessionVersion revocation: bumped on password reset (and available
  // for any other "log out everywhere" action). A token minted before
  // the bump carries the old version and is rejected here even though
  // its signature and expiry are still valid — this is what makes
  // "invalidate all sessions" actually work instead of just being a
  // label on an unused column.
  if (customer.sessionVersion !== tokenSessionVersion) return { status: "unauthenticated" };

  return {
    status: "ok",
    user: {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      emailVerifiedAt: customer.emailVerifiedAt,
    },
  };
}

// F-262: request-scoped memoization (React `cache()`), so a layout and the
// page under it that both read the shopper's session share one user lookup.
export const getCustomerSessionResult = cache(async function getCustomerSessionResult(): Promise<CustomerSessionResult> {
  let token: string | undefined;
  try {
    const cookieStore = await cookies();
    token = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
  } catch {
    // `cookies()` throws when called outside a Next.js request scope (a
    // route handler invoked directly from a unit/integration test, or a
    // script). Mirrors the admin session's fix: fail closed to
    // unauthenticated rather than throwing.
    return { status: "unauthenticated" };
  }
  if (!token) return { status: "unauthenticated" };

  return verifyCustomerSessionTokenResult(token);
});

/** Thin `CustomerSessionUser | null` wrapper over
 * {@link getCustomerSessionResult} for the existing callers that don't
 * need to distinguish "invalid" from "DB unavailable". */
export async function getCustomerSession(): Promise<CustomerSessionUser | null> {
  const result = await getCustomerSessionResult();
  return result.status === "ok" ? result.user : null;
}

export async function requireCustomerSession(): Promise<CustomerSessionUser> {
  const session = await getCustomerSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}
