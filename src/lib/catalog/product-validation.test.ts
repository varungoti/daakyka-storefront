import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertUniqueVariants,
  categoryCode,
  DuplicateVariantKeyError,
  DuplicateVariantSkuError,
  generateSku,
  generateVariantMatrix,
} from "@/lib/catalog/product-validation";

describe("categoryCode", () => {
  it("builds a 3+3 code from a two-word category name", () => {
    assert.equal(categoryCode("Scrub Sets"), "SCRSET");
  });

  it("pads a single-word category name", () => {
    assert.equal(categoryCode("Blazers"), "BLAZER");
  });

  it("falls back to GEN when nothing alphanumeric survives", () => {
    assert.equal(categoryCode("!!!"), "GEN");
  });
});

describe("generateSku", () => {
  it("builds the canonical DK-{CAT}-{SLUG}-{SIZE}-{COLOR} pattern", () => {
    const sku = generateSku({ categoryName: "Scrub Sets", productSlug: "classic-scrub-set", size: "M", color: "Ceil Blue" });
    assert.equal(sku, "DK-SCRSET-CLASSICSCRUBSET-M-CEILBLUE");
  });

  it("strips non-alphanumeric characters from size and color tokens", () => {
    const sku = generateSku({ categoryName: "Kids Wear", productSlug: "kids-tee", size: "2-3Y", color: "Sky Blue" });
    assert.equal(sku, "DK-KIDWEA-KIDSTEE-23Y-SKYBLUE");
  });
});

describe("generateVariantMatrix", () => {
  it("builds the cartesian product of sizes x colors with unique SKUs", () => {
    const variants = generateVariantMatrix({
      categoryName: "Scrub Sets",
      productSlug: "classic-scrub-set",
      sizes: ["S", "M"],
      colors: [{ name: "Navy", hex: "#1E3A5F" }, { name: "Wine", hex: "#722F37" }],
    });
    assert.equal(variants.length, 4);
    const skus = new Set(variants.map((v) => v.sku));
    assert.equal(skus.size, 4);
    assert.ok(variants.every((v) => v.stock === 0 && v.active === true));
  });

  it("de-duplicates repeated sizes and colors", () => {
    const variants = generateVariantMatrix({
      categoryName: "Scrub Sets",
      productSlug: "classic-scrub-set",
      sizes: ["S", "S", "M"],
      colors: [{ name: "Navy" }, { name: "Navy" }],
    });
    assert.equal(variants.length, 2);
  });
});

describe("assertUniqueVariants", () => {
  it("passes for unique (size,color) pairs and SKUs", () => {
    assert.doesNotThrow(() =>
      assertUniqueVariants([
        { size: "S", color: "Navy", sku: "DK-A-B-S-NAVY" },
        { size: "M", color: "Navy", sku: "DK-A-B-M-NAVY" },
      ]),
    );
  });

  it("rejects a duplicate (size,color) pair", () => {
    assert.throws(
      () =>
        assertUniqueVariants([
          { size: "S", color: "Navy", sku: "SKU-1" },
          { size: "S", color: "Navy", sku: "SKU-2" },
        ]),
      DuplicateVariantKeyError,
    );
  });

  it("rejects a duplicate SKU across different size/color pairs", () => {
    assert.throws(
      () =>
        assertUniqueVariants([
          { size: "S", color: "Navy", sku: "SAME-SKU" },
          { size: "M", color: "Wine", sku: "SAME-SKU" },
        ]),
      DuplicateVariantSkuError,
    );
  });
});
