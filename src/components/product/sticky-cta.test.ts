import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCtaScrolledPast, stickySelectionLabel } from "@/components/product/sticky-cta";

/**
 * F-025: the mobile sticky Add-to-Cart bar showed on page load (the CTA row
 * is below the fold, so "not intersecting" was true) and silently added the
 * pre-selected variant without ever showing which one.
 */
describe("isCtaScrolledPast (F-025)", () => {
  it("is false on first paint, when the CTA row is still below the fold", () => {
    assert.equal(isCtaScrolledPast({ isIntersecting: false, boundingClientRect: { bottom: 1500 } }), false);
  });

  it("is false while any part of the CTA row is on screen", () => {
    assert.equal(isCtaScrolledPast({ isIntersecting: true, boundingClientRect: { bottom: 300 } }), false);
    // Row partly scrolled off the top: still intersecting, so no bar yet.
    assert.equal(isCtaScrolledPast({ isIntersecting: true, boundingClientRect: { bottom: 20 } }), false);
  });

  it("is true once the whole CTA row has scrolled above the viewport", () => {
    assert.equal(isCtaScrolledPast({ isIntersecting: false, boundingClientRect: { bottom: -10 } }), true);
  });

  it("goes back to false when the shopper scrolls up to the row again", () => {
    assert.equal(isCtaScrolledPast({ isIntersecting: true, boundingClientRect: { bottom: 200 } }), false);
  });
});

describe("stickySelectionLabel (F-025)", () => {
  it("shows size and colour when the shopper can choose a colour", () => {
    assert.equal(stickySelectionLabel("S", "Navy", 4), "S · Navy");
  });

  it("omits the colour for a single-colour product", () => {
    assert.equal(stickySelectionLabel("M", "Wine", 1), "M");
  });

  it("omits a missing size", () => {
    assert.equal(stickySelectionLabel("", "Navy", 3), "Navy");
    assert.equal(stickySelectionLabel("", "Navy", 1), "");
  });
});
