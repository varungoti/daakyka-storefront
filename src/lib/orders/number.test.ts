import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateOrderNumberCandidate,
  isValidOrderNumberFormat,
} from "@/lib/orders/number";

describe("order number generation", () => {
  it("formats as DK-{year}-{6 digits}", () => {
    const candidate = generateOrderNumberCandidate(new Date("2026-03-15T00:00:00Z"));
    assert.match(candidate, /^DK-2026-\d{6}$/);
    assert.equal(isValidOrderNumberFormat(candidate), true);
  });

  it("rejects malformed order numbers", () => {
    assert.equal(isValidOrderNumberFormat("DK-2026-123"), false);
    assert.equal(isValidOrderNumberFormat("2026-000123"), false);
    assert.equal(isValidOrderNumberFormat("DK-26-000123"), false);
    assert.equal(isValidOrderNumberFormat(""), false);
  });

  it("produces distinct candidates across many calls (probabilistic uniqueness)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(generateOrderNumberCandidate());
    }
    // With 1,000,000 possible 6-digit suffixes, 500 draws colliding is
    // astronomically unlikely — a near-full set of unique values confirms
    // the generator isn't degenerate (e.g. always returning the same
    // value, or too small a range).
    assert.ok(seen.size > 490, `expected close to 500 unique candidates, got ${seen.size}`);
  });

  it("uses the current year by default", () => {
    const candidate = generateOrderNumberCandidate();
    const year = new Date().getFullYear();
    assert.match(candidate, new RegExp(`^DK-${year}-\\d{6}$`));
  });
});
