import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLocked, MAX_FAILED_ATTEMPTS, FAILURE_WINDOW_MS, LOCK_DURATION_MS } from "@/lib/auth/lockout";

/** Pure check only — recordFailedLogin/resetLoginFailures hit the DB and
 * are exercised end-to-end in tests/integration/admin-auth.test.ts.
 * Mirrors src/lib/customer-auth/lockout.test.ts's structure exactly, one
 * layer over the admin User model instead of Customer. */
describe("admin lockout", () => {
  it("is not locked when lockedUntil is null", () => {
    assert.equal(isLocked({ lockedUntil: null }), false);
  });

  it("is locked when lockedUntil is in the future", () => {
    assert.equal(isLocked({ lockedUntil: new Date(Date.now() + 60_000) }), true);
  });

  it("is not locked when lockedUntil is in the past", () => {
    assert.equal(isLocked({ lockedUntil: new Date(Date.now() - 60_000) }), false);
  });

  it("uses the same thresholds as customer-auth lockout (10 attempts / 15 min / 15 min lock)", () => {
    assert.equal(MAX_FAILED_ATTEMPTS, 10);
    assert.equal(FAILURE_WINDOW_MS, 15 * 60 * 1000);
    assert.equal(LOCK_DURATION_MS, 15 * 60 * 1000);
  });
});
