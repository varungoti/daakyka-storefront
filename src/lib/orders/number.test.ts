import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateOrderNumberCandidate,
  isValidOrderNumberFormat,
} from "@/lib/orders/number";

describe("order number generation", () => {
  it("formats as DK-{year}-{10 digits}", () => {
    const candidate = generateOrderNumberCandidate(new Date("2026-03-15T00:00:00Z"));
    assert.match(candidate, /^DK-2026-\d{10}$/);
    assert.equal(isValidOrderNumberFormat(candidate), true);
  });

  it("rejects malformed order numbers, including the old 6-digit format", () => {
    assert.equal(isValidOrderNumberFormat("DK-2026-123"), false);
    assert.equal(isValidOrderNumberFormat("DK-2026-000123"), false, "old 6-digit suffix must no longer validate");
    assert.equal(isValidOrderNumberFormat("2026-0000000123"), false);
    assert.equal(isValidOrderNumberFormat("DK-26-0000000123"), false);
    assert.equal(isValidOrderNumberFormat(""), false);
  });

  it("produces distinct candidates across many calls (probabilistic uniqueness)", () => {
    const seen = new Set<string>();
    const draws = 5000;
    for (let i = 0; i < draws; i++) {
      seen.add(generateOrderNumberCandidate());
    }
    // With 10,000,000,000 possible 10-digit suffixes, 5,000 draws
    // colliding is astronomically unlikely — every candidate should come
    // back unique, confirming the generator isn't degenerate (e.g. always
    // returning the same value, or drawing from too small a range).
    assert.equal(seen.size, draws, `expected all ${draws} candidates to be unique, got ${seen.size}`);
  });

  it("draws from the full 10-digit range, not a narrow sub-range", () => {
    // A weak/miswired RNG (e.g. accidentally bounded to 6 digits, or
    // always padding the same way) would never produce a candidate whose
    // suffix has a leading nonzero digit in its highest position. Confirm
    // at least one draw out of a reasonably sized sample uses the top of
    // the range.
    let sawLargeSuffix = false;
    for (let i = 0; i < 2000; i++) {
      const candidate = generateOrderNumberCandidate();
      const suffix = candidate.split("-")[2];
      if (suffix !== undefined && suffix.length === 10 && suffix[0] !== "0") {
        sawLargeSuffix = true;
        break;
      }
    }
    assert.ok(sawLargeSuffix, "expected at least one candidate in 2000 draws to use the full 10-digit range");
  });

  it("uses the current year by default", () => {
    const candidate = generateOrderNumberCandidate();
    const year = new Date().getFullYear();
    assert.match(candidate, new RegExp(`^DK-${year}-\\d{10}$`));
  });
});
