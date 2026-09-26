import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTrustItemDescriptions } from "@/components/layout/trust-bar";
import { trustItems } from "@/data/navigation";

/**
 * release-hardening audit F-008: the trust bar used to hard-code a
 * ₹8,299 free-shipping threshold (checkout/the PDP actually use the
 * `shipping.freeAbove` setting, ₹8,000 by default) and a "30-day return
 * policy" (the PDP's "Shipping & Returns" said 7 days). Both are now
 * derived from the same settings every other surface renders, so they
 * can't drift apart again.
 */
describe("computeTrustItemDescriptions", () => {
  it("renders the free-shipping threshold from the real setting, not a hard-coded number", () => {
    const descriptions = computeTrustItemDescriptions("₹8,000", 30);
    assert.equal(descriptions[0], "On orders over ₹8,000");
  });

  it("follows the free-shipping threshold when the admin changes the setting", () => {
    const descriptions = computeTrustItemDescriptions("₹9,500", 30);
    assert.equal(descriptions[0], "On orders over ₹9,500");
  });

  it("renders the return window from the real setting, not a hard-coded '30-day'", () => {
    const descriptions = computeTrustItemDescriptions("₹8,000", 7);
    assert.equal(descriptions[1], "7-day return policy");
  });

  it("leaves every other trust item's description untouched", () => {
    const descriptions = computeTrustItemDescriptions("₹8,000", 30);
    assert.equal(descriptions[2], trustItems[2].description);
    assert.equal(descriptions[3], trustItems[3].description);
    assert.equal(descriptions[4], trustItems[4].description);
  });

  it("no longer claims 24/7 support, which nothing in the admin can confirm", () => {
    assert.ok(!/24\/7/.test(trustItems[4].description));
  });
});
