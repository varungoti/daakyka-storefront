import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { db } from "@/lib/db";
import { verifyCustomerSessionTokenResult, getCustomerSession } from "@/lib/customer-auth/session";

// Mirrors the private CUSTOMER_JWT_AUDIENCE constant in session.ts — kept
// here rather than exported solely for this test, since nothing else
// needs it.
const CUSTOMER_JWT_AUDIENCE = "customer";

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is required");
  return new TextEncoder().encode(secret);
}

async function signCustomerToken(customerId: string, sessionVersion: number): Promise<string> {
  return new SignJWT({
    sub: customerId,
    email: "customer@example.com",
    name: "Test Customer",
    sv: sessionVersion,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(CUSTOMER_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}

/**
 * F-369 regression coverage, mirroring src/lib/auth/session.test.ts: a DB
 * failure while looking up the customer must be reported distinctly from
 * an invalid/expired token, not silently folded into the same
 * "unauthenticated" result. db.customer.findUnique is monkey-patched so
 * no real database connection is needed — see the admin-session sibling
 * test for the full rationale.
 */
describe("verifyCustomerSessionTokenResult (F-369)", () => {
  const originalFindUnique = db.customer.findUnique;

  afterEach(() => {
    db.customer.findUnique = originalFindUnique;
  });

  it("reports 'unauthenticated' for a malformed token without touching the DB", async () => {
    let called = false;
    db.customer.findUnique = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as unknown as typeof db.customer.findUnique;

    const result = await verifyCustomerSessionTokenResult("not-a-real-jwt");
    assert.deepEqual(result, { status: "unauthenticated" });
    assert.equal(called, false, "a bad token must fail before any DB lookup");
  });

  it("reports 'db-unavailable' (not 'unauthenticated') when the customer lookup throws", async () => {
    const token = await signCustomerToken("cust-1", 0);

    db.customer.findUnique = (async () => {
      throw new Error("Connection terminated due to connection timeout");
    }) as unknown as typeof db.customer.findUnique;

    const result = await verifyCustomerSessionTokenResult(token);
    assert.deepEqual(result, { status: "db-unavailable" });

    // getCustomerSession()'s own cookies()-throws branch (outside a real
    // request scope) always reports "unauthenticated" before reaching the
    // DB, so the thin wrapper's fail-closed null contract for existing
    // callers can't be exercised the same way here — that's covered by
    // the cookie-based flow in tests/integration/customer-auth.test.ts.
    assert.equal(await getCustomerSession(), null);
  });

  it("still reports 'ok' for a genuinely valid token once the DB call succeeds", async () => {
    const token = await signCustomerToken("cust-1", 0);

    db.customer.findUnique = (async () => ({
      id: "cust-1",
      email: "customer@example.com",
      name: "Test Customer",
      active: true,
      sessionVersion: 0,
      emailVerifiedAt: null,
    })) as unknown as typeof db.customer.findUnique;

    const result = await verifyCustomerSessionTokenResult(token);
    assert.equal(result.status, "ok");
    assert.equal(result.status === "ok" && result.user.id, "cust-1");
  });

  it("still reports 'unauthenticated' (not 'db-unavailable') for a revoked sessionVersion", async () => {
    const token = await signCustomerToken("cust-1", 0);

    db.customer.findUnique = (async () => ({
      id: "cust-1",
      email: "customer@example.com",
      name: "Test Customer",
      active: true,
      sessionVersion: 1, // bumped since the token was minted
      emailVerifiedAt: null,
    })) as unknown as typeof db.customer.findUnique;

    const result = await verifyCustomerSessionTokenResult(token);
    assert.deepEqual(result, { status: "unauthenticated" });
  });
});
