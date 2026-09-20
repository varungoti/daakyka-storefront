import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertUniqueVariants,
  categoryCode,
  DuplicateVariantKeyError,
  DuplicateVariantSkuError,
  generateSku,
  generateVariantMatrix,
  productNameToken,
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

describe("productNameToken", () => {
  it("is short — at most 6 letters + a 4-character checksum (10 total)", () => {
    const token = productNameToken("ux-audit-classic-comfort-scrub-set");
    assert.ok(token.length <= 10, `expected <=10 chars, got "${token}" (${token.length})`);
    // F-11: this is the exact real-world example from the audit
    // (docs/audit-2026-09-19/admin-ux.md), where the old scheme produced
    // the unreadable "UXAUDITCLASSICCOMFOR" (20 chars).
    assert.ok(token.length < "UXAUDITCLASSICCOMFOR".length);
  });

  it("is deterministic — same slug always produces the same token", () => {
    const a = productNameToken("classic-scrub-set");
    const b = productNameToken("classic-scrub-set");
    assert.equal(a, b);
  });

  it("is collision-resistant for slugs sharing a common word prefix", () => {
    // These would have collided under a naive "first N letters only"
    // scheme; the checksum suffix keeps them apart.
    const a = productNameToken("classic-comfort-scrub-top");
    const b = productNameToken("classic-comfort-scrub-set");
    assert.notEqual(a, b);
  });

  it("falls back to PRD when nothing alphanumeric survives, still with a checksum", () => {
    const token = productNameToken("---");
    assert.match(token, /^PRD[0-9A-Z]{4}$/);
  });
});

describe("generateSku", () => {
  it("builds the canonical DK-{CAT}-{NAMETOKEN}-{SIZE}-{COLOR} pattern", () => {
    const sku = generateSku({ categoryName: "Scrub Sets", productSlug: "classic-scrub-set", size: "M", color: "Ceil Blue" });
    assert.match(sku, /^DK-SCRSET-CLASCR[0-9A-Z]{4}-M-CEILBLUE$/);
  });

  it("strips non-alphanumeric characters from size and color tokens", () => {
    const sku = generateSku({ categoryName: "Kids Wear", productSlug: "kids-tee", size: "2-3Y", color: "Sky Blue" });
    assert.match(sku, /^DK-KIDWEA-KIDTEE[0-9A-Z]{4}-23Y-SKYBLUE$/);
  });

  it("is deterministic for identical inputs", () => {
    const params = { categoryName: "Scrub Sets", productSlug: "classic-scrub-set", size: "M", color: "Navy" };
    assert.equal(generateSku(params), generateSku(params));
  });

  it("produces a materially shorter SKU than the old unbounded-slug scheme for a long product name", () => {
    const longSlug = "ux-audit-classic-comfort-scrub-set-institutional-grade";
    const sku = generateSku({ categoryName: "Hospital Uniforms", productSlug: longSlug, size: "XS", color: "Navy" });
    // Old scheme: DK-{6}-{up to 20}-{size}-{color}; new scheme's name
    // token is capped at 10, so the whole SKU is well under the old
    // worst case for a name this long.
    assert.ok(sku.length < `DK-FORHOS-${longSlug.toUpperCase().replace(/-/g, "").slice(0, 20)}-XS-NAVY`.length);
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
