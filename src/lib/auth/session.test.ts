import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { signSessionToken, verifySessionToken, verifySessionTokenResult } from "@/lib/auth/session";

/**
 * F-369 regression coverage: verifySessionToken()/verifySessionTokenResult()
 * must distinguish "bad/expired token" from "the DB was unreachable while
 * checking it" instead of collapsing both into the same silent `null`.
 *
 * Unit-level, not integration: db.user.findUnique is monkey-patched to
 * simulate a DB failure deterministically, without touching a real
 * database at all (the module-level `db` singleton never eagerly connects
 * — see src/lib/create-prisma-client.ts — so this is safe even with no
 * Postgres reachable). This mirrors the DB-connectivity fixture pattern
 * used in create-prisma-client.test.ts, one layer up.
 */
describe("verifySessionTokenResult (F-369)", () => {
  const originalFindUnique = db.user.findUnique;

  afterEach(() => {
    db.user.findUnique = originalFindUnique;
  });

  it("reports 'unauthenticated' for a malformed token without touching the DB", async () => {
    let called = false;
    db.user.findUnique = (async () => {
      called = true;
      throw new Error("should not be called");
    }) as unknown as typeof db.user.findUnique;

    const result = await verifySessionTokenResult("not-a-real-jwt");
    assert.deepEqual(result, { status: "unauthenticated" });
    assert.equal(called, false, "a bad token must fail before any DB lookup");
    assert.equal(await verifySessionToken("not-a-real-jwt"), null);
  });

  it("reports 'db-unavailable' (not 'unauthenticated') when the session lookup throws", async () => {
    const token = await signSessionToken(
      { id: "user-1", email: "admin@example.com", name: "Admin", role: "SUPER_ADMIN" },
      0,
    );

    db.user.findUnique = (async () => {
      throw new Error("Connection terminated due to connection timeout");
    }) as unknown as typeof db.user.findUnique;

    const result = await verifySessionTokenResult(token);
    assert.deepEqual(result, { status: "db-unavailable" });

    // The thin public wrapper still returns null (fail-closed) so the ~90
    // existing SessionUser | null callers keep working unchanged — only
    // callers using verifySessionTokenResult/getSessionResult directly see
    // the distinction.
    assert.equal(await verifySessionToken(token), null);
  });

  it("still reports 'ok' for a genuinely valid token once the DB call succeeds", async () => {
    const token = await signSessionToken(
      { id: "user-1", email: "admin@example.com", name: "Admin", role: "SUPER_ADMIN" },
      0,
    );

    db.user.findUnique = (async () => ({
      id: "user-1",
      email: "admin@example.com",
      name: "Admin",
      role: "SUPER_ADMIN",
      active: true,
      sessionVersion: 0,
    })) as unknown as typeof db.user.findUnique;

    const result = await verifySessionTokenResult(token);
    assert.equal(result.status, "ok");
    assert.equal(result.status === "ok" && result.user.id, "user-1");
  });

  it("still reports 'unauthenticated' (not 'db-unavailable') for a revoked sessionVersion", async () => {
    const token = await signSessionToken(
      { id: "user-1", email: "admin@example.com", name: "Admin", role: "SUPER_ADMIN" },
      0,
    );

    db.user.findUnique = (async () => ({
      id: "user-1",
      email: "admin@example.com",
      name: "Admin",
      role: "SUPER_ADMIN",
      active: true,
      sessionVersion: 1, // bumped since the token was minted
    })) as unknown as typeof db.user.findUnique;

    const result = await verifySessionTokenResult(token);
    assert.deepEqual(result, { status: "unauthenticated" });
  });
});
