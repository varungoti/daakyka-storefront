import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { POST as postLogin } from "@/app/api/auth/login/route";

function jsonRequest(url: string, method: string, body?: unknown): Request {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * F-164: failed admin logins and account lockouts previously left no trace
 * on /admin/audit-logs — only a successful login wrote an AuditLog row.
 * This covers the audit-trail side effect the fix adds to
 * src/app/api/auth/login/route.ts.
 *
 * tests/integration/admin-auth.test.ts (owned by a parallel package)
 * already covers the lockout status-code/DB-field behaviour for the same
 * route in detail — this file is scoped to the audit-log side effect only,
 * so it doesn't duplicate that coverage or need to touch that forbidden
 * file. Same harness note applies here: the route handler is called
 * directly rather than through a real Next.js request, so a successful
 * login (which calls createSession()) isn't exercised here — only the
 * failure/lockout branches, which are what F-164 is about.
 */
describe("admin login audit trail (F-164)", () => {
  const createdUserIds: string[] = [];

  after(async () => {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
  });

  it("logs a login_failed audit event for a wrong password against a known account", async () => {
    const unique = randomUUID().slice(0, 8);
    const email = `audit-fail-${unique}@example.com`;
    const user = await db.user.create({
      data: { email, name: "Audit Fail Admin", passwordHash: await hashPassword("correct-password-1"), role: "VIEWER" },
    });
    createdUserIds.push(user.id);

    await resetRateLimits(["auth-login", "admin-login"]);
    const response = await postLogin(
      jsonRequest("http://localhost/api/auth/login", "POST", { email, password: "wrong-password" }),
    );
    assert.equal(response.status, 401);

    const events = await db.auditLog.findMany({ where: { entity: "user", entityId: user.id, action: "login_failed" } });
    assert.equal(events.length, 1);
  });

  it("does not log anything for an unknown email (logging it would let an attacker enumerate admin accounts)", async () => {
    const email = `audit-unknown-${randomUUID().slice(0, 8)}@example.com`;
    await resetRateLimits(["auth-login", "admin-login"]);
    const response = await postLogin(
      jsonRequest("http://localhost/api/auth/login", "POST", { email, password: "whatever123" }),
    );
    assert.equal(response.status, 401);

    const events = await db.auditLog.findMany({ where: { metadata: { contains: email } } });
    assert.equal(events.length, 0);
  });

  it("logs a login_locked event on the attempt that trips the lockout, and again on every attempt made while still locked", async () => {
    const unique = randomUUID().slice(0, 8);
    const email = `audit-lock-${unique}@example.com`;
    const user = await db.user.create({
      data: { email, name: "Audit Lock Admin", passwordHash: await hashPassword("correct-password-1"), role: "VIEWER" },
    });
    createdUserIds.push(user.id);

    for (let attempt = 1; attempt <= 9; attempt += 1) {
      await resetRateLimits(["auth-login", "admin-login"]);
      const response = await postLogin(
        jsonRequest("http://localhost/api/auth/login", "POST", { email, password: "wrong-password" }),
      );
      assert.equal(response.status, 401, `attempt ${attempt} should still be a plain 401`);
    }

    await resetRateLimits(["auth-login", "admin-login"]);
    const lockedResponse = await postLogin(
      jsonRequest("http://localhost/api/auth/login", "POST", { email, password: "wrong-password" }),
    );
    assert.equal(lockedResponse.status, 423, "the 10th failed attempt should lock the account");

    // A further attempt while still locked hits the isLocked() branch
    // instead of recordFailedLogin, and must still be logged.
    await resetRateLimits(["auth-login", "admin-login"]);
    const stillLockedResponse = await postLogin(
      jsonRequest("http://localhost/api/auth/login", "POST", { email, password: "correct-password-1" }),
    );
    assert.equal(stillLockedResponse.status, 423);

    const lockEvents = await db.auditLog.findMany({ where: { entity: "user", entityId: user.id, action: "login_locked" } });
    assert.equal(lockEvents.length, 2, "one for crossing the threshold, one for the still-locked attempt after it");
    for (const event of lockEvents) {
      assert.ok(event.metadata && JSON.parse(event.metadata).lockedUntil, "each lockout event should record lockedUntil");
    }

    const failEvents = await db.auditLog.findMany({ where: { entity: "user", entityId: user.id, action: "login_failed" } });
    assert.equal(failEvents.length, 9);
  });
});
