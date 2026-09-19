import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { signSessionToken, verifySessionToken } from "@/lib/auth/session";
import { buildUserUpdateData } from "@/lib/auth/user-updates";
import { POST as postLogin } from "@/app/api/auth/login/route";

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Phase G: admin login lockout (v1 2.2) and session revocation (v1 2.3).
 *
 * Same harness limitation documented in tests/integration/customer-auth.test.ts
 * applies here: calling the route handler directly (not through a real
 * Next.js request) means cookies() throws inside createSession() on the
 * success path, so a correct login can only be asserted as one of
 * [200, 500] rather than a clean 200 — the DB side effects (lockout
 * counters resetting) still happen before that throw and are asserted
 * directly. The full cookie-based flow is exercised against a live
 * `npm run start` server in the runtime verification step.
 */
describe("admin auth (Phase G)", () => {
  const createdUserIds: string[] = [];

  after(async () => {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
  });

  describe("POST /api/auth/login lockout", () => {
    it("locks the account after 10 failed attempts within the window (returns 423)", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `admin-lockout-${unique}@example.com`;
      const user = await db.user.create({
        data: {
          email,
          name: "Lockout Test Admin",
          passwordHash: await hashPassword("correct-password-1"),
          role: "VIEWER",
        },
      });
      createdUserIds.push(user.id);

      // Each iteration resets the in-memory/DB rate-limit bucket first —
      // this test is specifically about the account-lockout counter on
      // the User row, not the separate per-IP rate limiter that would
      // otherwise return 429 well before the 10th attempt.
      for (let attempt = 1; attempt <= 9; attempt += 1) {
        await resetRateLimits(["auth-login", "admin-login"]);
        const response = await postLogin(
          jsonRequest("http://localhost/api/auth/login", "POST", {
            email,
            password: "wrong-password",
          }),
        );
        assert.equal(response.status, 401, `attempt ${attempt} should still be a plain 401`);
      }

      await resetRateLimits(["auth-login", "admin-login"]);
      const lockedResponse = await postLogin(
        jsonRequest("http://localhost/api/auth/login", "POST", {
          email,
          password: "wrong-password",
        }),
      );
      assert.equal(lockedResponse.status, 423, "the 10th failed attempt should lock the account");

      const locked = await db.user.findUnique({ where: { id: user.id } });
      assert.ok(locked!.lockedUntil && locked!.lockedUntil.getTime() > Date.now());

      // Even the correct password is rejected while locked.
      await resetRateLimits(["auth-login", "admin-login"]);
      const correctButLocked = await postLogin(
        jsonRequest("http://localhost/api/auth/login", "POST", {
          email,
          password: "correct-password-1",
        }),
      );
      assert.equal(correctButLocked.status, 423);
    });

    it("accepts the correct password again once lockedUntil has passed (simulated by moving it to the past)", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `admin-lockout-expiry-${unique}@example.com`;
      const user = await db.user.create({
        data: {
          email,
          name: "Lockout Expiry Test Admin",
          passwordHash: await hashPassword("correct-password-1"),
          role: "VIEWER",
          failedLoginCount: 10,
          lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      createdUserIds.push(user.id);

      await resetRateLimits(["auth-login", "admin-login"]);
      const stillLocked = await postLogin(
        jsonRequest("http://localhost/api/auth/login", "POST", { email, password: "correct-password-1" }),
      );
      assert.equal(stillLocked.status, 423);

      // Simulate the 15-minute window passing without literally sleeping.
      await db.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });

      await resetRateLimits(["auth-login", "admin-login"]);
      const response = await postLogin(
        jsonRequest("http://localhost/api/auth/login", "POST", { email, password: "correct-password-1" }),
      );
      // See the describe-level note: the success path 500s in this harness
      // because createSession() calls cookies() outside a request scope.
      assert.ok([200, 500].includes(response.status));

      const updated = await db.user.findUnique({ where: { id: user.id } });
      assert.equal(updated!.failedLoginCount, 0);
      assert.equal(updated!.lockedUntil, null);
    });

    it("returns 401 (not 423) for an unknown email via the timing-safe dummy compare", async () => {
      await resetRateLimits(["auth-login", "admin-login"]);
      const response = await postLogin(
        jsonRequest("http://localhost/api/auth/login", "POST", {
          email: `nope-${randomUUID().slice(0, 8)}@example.com`,
          password: "whatever123",
        }),
      );
      assert.equal(response.status, 401);
    });
  });

  describe("session revocation (sessionVersion)", () => {
    it("rejects a token whose sessionVersion no longer matches the DB", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `admin-revoke-${unique}@example.com`;
      const user = await db.user.create({
        data: {
          email,
          name: "Revocation Test Admin",
          passwordHash: await hashPassword("correct-password-1"),
          role: "STORE_OWNER",
        },
      });
      createdUserIds.push(user.id);

      const token = await signSessionToken(
        { id: user.id, email: user.email, name: user.name, role: user.role },
        user.sessionVersion,
      );

      const validSession = await verifySessionToken(token);
      assert.ok(validSession, "a freshly issued token should verify");
      assert.equal(validSession!.id, user.id);

      // Bump sessionVersion directly, as PATCH /api/admin/users/[id] does
      // via buildUserUpdateData on deactivation/role change.
      await db.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });

      const revokedSession = await verifySessionToken(token);
      assert.equal(revokedSession, null, "the old token must be rejected after the version bump");
    });

    it("buildUserUpdateData's bump actually invalidates a previously-issued token end to end", async () => {
      const unique = randomUUID().slice(0, 8);
      const email = `admin-revoke-e2e-${unique}@example.com`;
      const user = await db.user.create({
        data: {
          email,
          name: "Revocation E2E Admin",
          passwordHash: await hashPassword("correct-password-1"),
          role: "VIEWER",
        },
      });
      createdUserIds.push(user.id);

      const token = await signSessionToken(
        { id: user.id, email: user.email, name: user.name, role: user.role },
        user.sessionVersion,
      );
      assert.ok(await verifySessionToken(token));

      // Simulate PATCH /api/admin/users/[id] deactivating the user.
      const { data } = buildUserUpdateData(
        { active: user.active, role: user.role },
        { name: user.name, role: user.role, active: false },
      );
      await db.user.update({ where: { id: user.id }, data });

      assert.equal(await verifySessionToken(token), null);
    });
  });
});
