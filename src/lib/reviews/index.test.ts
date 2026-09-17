import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { anonymizeReviewerName, computeReviewSummary } from "@/lib/reviews";

describe("computeReviewSummary", () => {
  it("returns a zeroed summary for an empty list", () => {
    const summary = computeReviewSummary([]);
    assert.equal(summary.count, 0);
    assert.equal(summary.average, 0);
    assert.deepEqual(summary.histogram, { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 });
  });

  it("counts each rating into its histogram bucket", () => {
    const summary = computeReviewSummary([5, 5, 4, 3, 1, 1, 1]);
    assert.equal(summary.count, 7);
    assert.deepEqual(summary.histogram, { 5: 2, 4: 1, 3: 1, 2: 0, 1: 3 });
  });

  it("computes the average rating", () => {
    const summary = computeReviewSummary([5, 4, 3]);
    assert.equal(summary.average, 4);
  });

  it("clamps and rounds fractional/out-of-range ratings into a valid bucket", () => {
    // Defensive: real Review rows are constrained to 1-5 ints, but the
    // histogram math shouldn't throw or silently drop odd input either.
    const summary = computeReviewSummary([4.6, 0, 6]);
    assert.equal(summary.histogram[5], 2); // 4.6 rounds to 5, 6 clamps to 5
    assert.equal(summary.histogram[1], 1); // 0 clamps to 1
  });
});

describe("anonymizeReviewerName", () => {
  it("keeps the first name and initials the last", () => {
    assert.equal(anonymizeReviewerName("Priya Sharma"), "Priya S.");
  });

  it("handles a single-word name", () => {
    assert.equal(anonymizeReviewerName("Priya"), "Priya");
  });

  it("collapses extra whitespace", () => {
    assert.equal(anonymizeReviewerName("  Priya   Sharma  "), "Priya S.");
  });

  it("falls back to Anonymous for a blank name", () => {
    assert.equal(anonymizeReviewerName(""), "Anonymous");
    assert.equal(anonymizeReviewerName("   "), "Anonymous");
  });

  it("handles more than two name parts by using the second as the initial", () => {
    assert.equal(anonymizeReviewerName("Priya Devi Sharma"), "Priya D.");
  });
});
