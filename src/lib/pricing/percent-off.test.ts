import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePercentOff } from "@/lib/pricing/percent-off";

describe("computePercentOff", () => {
  it("returns null when there is no compareAtPrice", () => {
    assert.equal(computePercentOff(500, undefined), null);
    assert.equal(computePercentOff(500, null), null);
  });

  it("returns null when compareAtPrice is not actually higher", () => {
    assert.equal(computePercentOff(500, 500), null);
    assert.equal(computePercentOff(500, 400), null);
  });

  it("returns null for non-finite or non-positive inputs", () => {
    assert.equal(computePercentOff(NaN, 600), null);
    assert.equal(computePercentOff(500, 0), null);
    assert.equal(computePercentOff(500, -100), null);
  });

  it("computes and rounds the discount percentage", () => {
    assert.equal(computePercentOff(750, 1000), 25);
    assert.equal(computePercentOff(499, 999), 50);
    assert.equal(computePercentOff(333, 1000), 67);
  });
});
