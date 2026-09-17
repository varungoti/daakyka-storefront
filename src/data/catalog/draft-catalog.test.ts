import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  draftCategories,
  draftCategorySlugs,
  draftProducts,
  draftSizeChartKeys,
  draftSizeCharts,
} from "@/data/catalog/draft-catalog";

describe("draft catalog data", () => {
  it("has unique category slugs", () => {
    const slugs = draftCategories.map((c) => c.slug);
    assert.equal(slugs.length, new Set(slugs).size, "duplicate category slug found");
  });

  it("every category's parentSlug (when set) references a real category", () => {
    for (const category of draftCategories) {
      if (category.parentSlug) {
        assert.ok(
          draftCategorySlugs.has(category.parentSlug),
          `category "${category.slug}" has an unknown parentSlug "${category.parentSlug}"`,
        );
      }
    }
  });

  it("every category's sizeChartKey (when set) references a real chart", () => {
    for (const category of draftCategories) {
      if (category.sizeChartKey) {
        assert.ok(
          draftSizeChartKeys.has(category.sizeChartKey),
          `category "${category.slug}" references unknown sizeChartKey "${category.sizeChartKey}"`,
        );
      }
    }
  });

  it("categories only use the four defined sections", () => {
    const validSections = new Set(["HOSPITAL", "SCHOOL", "KIDS", "GENERAL"]);
    for (const category of draftCategories) {
      assert.ok(validSections.has(category.section), `invalid section on "${category.slug}"`);
    }
  });

  it("has unique size chart keys", () => {
    const keys = draftSizeCharts.map((c) => c.key);
    assert.equal(keys.length, new Set(keys).size);
  });

  it("every size chart has at least one row and one column", () => {
    for (const chart of draftSizeCharts) {
      assert.ok(chart.columns.length > 0, `chart "${chart.key}" has no columns`);
      assert.ok(chart.rows.length > 0, `chart "${chart.key}" has no rows`);
    }
  });

  it("has unique product slugs", () => {
    const slugs = draftProducts.map((p) => p.slug);
    assert.equal(slugs.length, new Set(slugs).size, "duplicate product slug found");
  });

  it("every product references a real category slug", () => {
    for (const product of draftProducts) {
      assert.ok(
        draftCategorySlugs.has(product.categorySlug),
        `product "${product.slug}" references unknown category "${product.categorySlug}"`,
      );
    }
  });

  it("every product's sizeChartKey (when set) references a real chart", () => {
    for (const product of draftProducts) {
      if (product.sizeChartKey) {
        assert.ok(
          draftSizeChartKeys.has(product.sizeChartKey),
          `product "${product.slug}" references unknown sizeChartKey "${product.sizeChartKey}"`,
        );
      }
    }
  });

  it("every product has at least one variant", () => {
    for (const product of draftProducts) {
      assert.ok(product.variants.length > 0, `product "${product.slug}" has no variants`);
    }
  });

  it("every product has a positive price", () => {
    for (const product of draftProducts) {
      assert.ok(product.price > 0, `product "${product.slug}" has a non-positive price`);
    }
  });

  it("compareAtPrice, when set, is strictly greater than price", () => {
    for (const product of draftProducts) {
      if (product.compareAtPrice !== undefined) {
        assert.ok(
          product.compareAtPrice > product.price,
          `product "${product.slug}" has compareAtPrice <= price`,
        );
      }
    }
  });

  it("has at least 5 products on sale (compareAtPrice set)", () => {
    const onSale = draftProducts.filter((p) => p.compareAtPrice !== undefined);
    assert.ok(onSale.length >= 5, `expected >= 5 sale products, got ${onSale.length}`);
  });

  it("has roughly 60 products total", () => {
    assert.ok(
      draftProducts.length >= 50 && draftProducts.length <= 70,
      `expected ~60 products, got ${draftProducts.length}`,
    );
  });

  it("has roughly the right product counts per section (plan E1)", () => {
    const bySection: Record<string, number> = {};
    const categoryToSection = new Map(draftCategories.map((c) => [c.slug, c.section]));
    for (const product of draftProducts) {
      const section = categoryToSection.get(product.categorySlug) ?? "UNKNOWN";
      bySection[section] = (bySection[section] ?? 0) + 1;
    }
    assert.ok((bySection.HOSPITAL ?? 0) >= 18, `HOSPITAL count too low: ${bySection.HOSPITAL}`);
    assert.ok((bySection.HOSPITAL ?? 0) <= 30, `HOSPITAL count too high: ${bySection.HOSPITAL}`);
    assert.ok((bySection.SCHOOL ?? 0) >= 14, `SCHOOL count too low: ${bySection.SCHOOL}`);
    assert.ok((bySection.SCHOOL ?? 0) <= 26, `SCHOOL count too high: ${bySection.SCHOOL}`);
    assert.ok((bySection.KIDS ?? 0) >= 6, `KIDS count too low: ${bySection.KIDS}`);
    assert.ok((bySection.KIDS ?? 0) <= 14, `KIDS count too high: ${bySection.KIDS}`);
    assert.ok((bySection.GENERAL ?? 0) >= 4, `GENERAL count too low: ${bySection.GENERAL}`);
  });

  it("every variant has a unique SKU across the whole catalog", () => {
    const skus = draftProducts.flatMap((p) => p.variants.map((v) => v.sku));
    const duplicates = skus.filter((sku, index) => skus.indexOf(sku) !== index);
    assert.deepEqual([...new Set(duplicates)], [], "duplicate SKUs found");
  });

  it("every variant has stock between 10 and 80 inclusive", () => {
    for (const product of draftProducts) {
      for (const variant of product.variants) {
        assert.ok(
          variant.stock >= 10 && variant.stock <= 80,
          `variant ${variant.sku} has out-of-range stock ${variant.stock}`,
        );
      }
    }
  });

  it("blazers are tagged made-to-measure", () => {
    const blazers = draftProducts.filter((p) => p.categorySlug === "blazers");
    assert.ok(blazers.length > 0);
    for (const blazer of blazers) {
      assert.ok(blazer.tags.includes("made-to-measure"));
    }
  });
});
