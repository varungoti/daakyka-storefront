import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ADMIN_SEED_PASSWORD,
  INSECURE_SEED_PASSWORDS,
  isInsecureSeedPassword,
} from "@/lib/auth/seed-defaults";

describe("isInsecureSeedPassword", () => {
  it("rejects the documented local-dev default", () => {
    assert.equal(isInsecureSeedPassword(DEFAULT_ADMIN_SEED_PASSWORD), true);
  });

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
