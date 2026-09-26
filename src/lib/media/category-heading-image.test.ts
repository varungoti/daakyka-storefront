import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveCategoryHeadingImage } from "@/lib/media/category-heading-image";

/**
 * release-hardening audit F-364: an image uploaded through the category
 * editor's own picker (Category.image) never showed up on that category's
 * own /category/[slug] page, because the page only ever read the separate
 * `category.<slug>` Site Images slot.
 */
describe("resolveCategoryHeadingImage", () => {
  it("prefers the category.<slug> Site Images slot when it's set", () => {
    const result = resolveCategoryHeadingImage(
      { url: "/slot.jpg", alt: "Slot alt" },
      { image: { url: "/editor.jpg", alt: "Editor alt" }, name: "Scrub Sets" },
    );
    assert.deepEqual(result, { url: "/slot.jpg", alt: "Slot alt" });
  });

  it("falls back to Category.image when the slot is empty", () => {
    const result = resolveCategoryHeadingImage(null, {
      image: { url: "/editor.jpg", alt: "Editor alt" },
      name: "Scrub Sets",
    });
    assert.deepEqual(result, { url: "/editor.jpg", alt: "Editor alt" });
  });

  it("uses the category name as alt text when Category.image has none", () => {
    const result = resolveCategoryHeadingImage(null, {
      image: { url: "/editor.jpg", alt: null },
      name: "Scrub Sets",
    });
    assert.deepEqual(result, { url: "/editor.jpg", alt: "Scrub Sets" });
  });

  it("returns null when neither the slot nor Category.image is set", () => {
    const result = resolveCategoryHeadingImage(null, { image: null, name: "Scrub Sets" });
    assert.equal(result, null);
  });
});
