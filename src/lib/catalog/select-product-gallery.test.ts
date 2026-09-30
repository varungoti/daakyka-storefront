import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectProductGallery } from "./select-product-gallery";

const base = { productName: "Scrub Top", color: "Navy", size: "S", colorCount: 2 };

describe("selectProductGallery", () => {
  it("shows only exact-size and verified shared views for the selected colour", () => {
    const result = selectProductGallery({
      ...base,
      images: [
        { url: "/red.webp", color: "Red", size: "S" },
        { url: "/navy-m.webp", color: "Navy", size: "M" },
        { url: "/navy-s.webp", color: "Navy", size: "S" },
        { url: "/navy-s.webp", color: "Navy", size: "S" },
        { url: "/navy-shared.webp", color: "Navy", appliesToAllSizes: true },
        { url: "/untagged.webp" },
      ],
    });
    assert.deepEqual(result.images.map((image) => image.url), ["/navy-s.webp", "/navy-shared.webp"]);
    assert.equal(result.verifiedViews, 2);
    assert.equal(result.representativeFallback, false);
  });

  it("keeps legacy general imagery visible but does not count it as size proof", () => {
    const result = selectProductGallery({
      ...base,
      images: [{ url: "/navy.webp", color: "Navy" }, { url: "/red.webp", color: "Red" }],
    });
    assert.deepEqual(result.images.map((image) => image.url), ["/navy.webp"]);
    assert.equal(result.verifiedViews, 0);
    assert.equal(result.representativeFallback, true);
  });

  it("shows all three same-colour AI views for each listed size without claiming size verification", () => {
    const images = ["front", "detail", "side"].map((view) => ({
      url: `/sky-blue-${view}.webp`, color: "Sky Blue", alt: `AI-generated colour interpretation, ${view}`,
    }));
    for (const size of ["2-3Y", "4-5Y", "6-7Y", "8-9Y", "10-11Y"]) {
      const gallery = selectProductGallery({ productName: "Kids Cotton T-Shirt", color: "Sky Blue", size,
        colorCount: 4, images });
      assert.equal(gallery.images.length, 3);
      assert.equal(gallery.verifiedViews, 0);
      assert.equal(gallery.representativeFallback, true);
      assert.ok(gallery.images.every((image) => image.alt.includes("colour interpretation")));
    }
  });

  it("keeps same-colour representative views alongside an exact-size view", () => {
    const result = selectProductGallery({
      ...base,
      images: [
        { url: "/navy-main.webp", color: "Navy" },
        { url: "/navy-verified.webp", color: "Navy", size: "S" },
        { url: "/navy-m.webp", color: "Navy", size: "M" },
      ],
    });
    assert.deepEqual(result.images.map((image) => image.url), ["/navy-main.webp", "/navy-verified.webp"]);
    assert.equal(result.verifiedViews, 1);
    assert.equal(result.representativeFallback, true);
  });

  it("uses an honest placeholder for an unpictured colour", () => {
    const result = selectProductGallery({ ...base, images: [{ url: "/untagged.webp" }] });
    assert.equal(result.images[0].url, "/placeholder-product.svg");
    assert.equal(result.verifiedViews, 0);
  });

  it("accepts untagged colour for a single-colour product", () => {
    const result = selectProductGallery({ ...base, colorCount: 1, images: [{ url: "/shared.webp", appliesToAllSizes: true }] });
    assert.equal(result.images[0].url, "/shared.webp");
    assert.equal(result.verifiedViews, 1);
  });
});
