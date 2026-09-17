import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeEquals } from "@/lib/security/timing-safe-equal";

describe("safeEquals", () => {
  it("returns true for identical strings", () => {
    assert.equal(safeEquals("same-value", "same-value"), true);
  });

  it("returns false for different strings of the same length", () => {
    assert.equal(safeEquals("aaaaaaaaaa", "bbbbbbbbbb"), false);
  });

  it("returns false for different-length strings without throwing", () => {
    assert.doesNotThrow(() => safeEquals("short", "a-much-longer-value"));
    assert.equal(safeEquals("short", "a-much-longer-value"), false);
  });

  it("returns false when either value is empty", () => {
    assert.equal(safeEquals("", "non-empty"), false);
    assert.equal(safeEquals("non-empty", ""), false);
  });
});
