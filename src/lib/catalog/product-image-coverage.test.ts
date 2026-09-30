import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findProductImageCoverageGaps, findVerifiedSizeImageCoverageGaps } from "./product-image-coverage";

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

describe("findVerifiedSizeImageCoverageGaps", () => {
  it("requires three distinct photos verified for each active colour and size", () => {
    const gaps = findVerifiedSizeImageCoverageGaps([{
      slug: "scrub-top",
      name: "Scrub Top",
      variants: [
        { color: "Navy", size: "S", active: true },
        { color: "Navy", size: "M", active: true },
        { color: "Red", size: "S", active: false },
      ],
      images: [
        { mediaId: "shared-1", color: "Navy", appliesToAllSizes: true },
        { mediaId: "shared-2", color: "Navy", appliesToAllSizes: true },
        { mediaId: "size-s", color: "Navy", size: "S" },
        { mediaId: "legacy", color: "Navy" },
        { mediaId: "wrong-color", color: "Red", appliesToAllSizes: true },
      ],
    }]);
    assert.deepEqual(gaps, [{ slug: "scrub-top", color: "Navy", size: "M", verifiedImageCount: 2, missing: 1 }]);
  });

  it("does not count repeated media ids or unverified shared images", () => {
    const gaps = findVerifiedSizeImageCoverageGaps([{
      slug: "sheet",
      name: "Sheet",
      variants: [{ color: "White", size: "Double", active: true }],
      images: [
        { mediaId: "one", color: null, appliesToAllSizes: true },
        { mediaId: "one", color: null, size: "Double" },
        { mediaId: "two", color: null },
      ],
    }]);
    assert.deepEqual(gaps, [{ slug: "sheet", color: "White", size: "Double", verifiedImageCount: 1, missing: 2 }]);
  });
});
