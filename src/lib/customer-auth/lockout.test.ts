import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isLocked } from "@/lib/customer-auth/lockout";

/** Pure check only — recordFailedLogin/resetLoginFailures hit the DB and
 * are exercised end-to-end in tests/integration/customer-auth.test.ts. */
describe("customer-auth lockout", () => {
  it("is not locked when lockedUntil is null", () => {
    assert.equal(isLocked({ lockedUntil: null }), false);
  });

  it("is locked when lockedUntil is in the future", () => {
    assert.equal(isLocked({ lockedUntil: new Date(Date.now() + 60_000) }), true);
  });

  it("is not locked when lockedUntil is in the past", () => {
    assert.equal(isLocked({ lockedUntil: new Date(Date.now() - 60_000) }), false);
  });
});
