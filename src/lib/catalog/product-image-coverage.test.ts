import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findProductImageCoverageGaps } from "./product-image-coverage";

describe("findProductImageCoverageGaps", () => {
  it("requires three distinct colour-accurate photos shared across active sizes", () => {
    const gaps = findProductImageCoverageGaps([{
      slug: "scrub-top",
      name: "Scrub Top",
      variants: [
        { color: "Navy", size: "S", active: true },
        { color: "Navy", size: "M", active: true },
        { color: "White", size: "S", active: true },
        { color: "White", size: "M", active: false },
      ],
      images: [
        { mediaId: "navy-1", color: "Navy" },
        { mediaId: "navy-1", color: "Navy" },
        { mediaId: "white-1", color: "White" },
        { mediaId: "shared", color: null },
      ],
    }]);
    assert.deepEqual(gaps.map(({ color, sizes, imageCount, missing }) => ({ color, sizes, imageCount, missing })), [
      { color: "Navy", sizes: ["M", "S"], imageCount: 1, missing: 2 },
      { color: "White", sizes: ["S"], imageCount: 1, missing: 2 },
    ]);
  });

  it("accepts untagged photos for a single-colour product", () => {
    const gaps = findProductImageCoverageGaps([{
      slug: "bedsheet",
      name: "Bedsheet",
      variants: [{ color: "White", size: "Double", active: true }],
      images: ["one", "two", "three"].map((mediaId) => ({ mediaId, color: null })),
    }]);
    assert.deepEqual(gaps, []);
  });
});
