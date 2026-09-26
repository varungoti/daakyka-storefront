import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { INSECURE_SEED_PASSWORDS, isInsecureSeedPassword } from "@/lib/auth/seed-defaults";

// F-301: this project's real, once-published SUPER_ADMIN/VIEWER seed
// defaults are deny-listed by SHA-256 digest inside seed-defaults.ts, not
// by value, precisely so the leaked plaintext never gets reintroduced to
// the repo — including here, as a "known-bad" test fixture. So this file
// only exercises the generic weak-password list and the length rule,
// which don't carry that risk.
describe("isInsecureSeedPassword", () => {
  it("rejects every password in the known-insecure list", () => {
    for (const password of INSECURE_SEED_PASSWORDS) {
      assert.equal(isInsecureSeedPassword(password), true, `expected "${password}" to be insecure`);
    }
  });

  it("rejects passwords shorter than 12 characters even if not listed", () => {
    assert.equal(isInsecureSeedPassword("Sh0rt!"), true);
  });

  it("accepts a long, unique password", () => {
    assert.equal(isInsecureSeedPassword("kX9-correct-horse-battery-42"), false);
  });
});
