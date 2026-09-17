import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupRowsByProduct, IMPORT_COLUMNS, parseCsv, stringifyCsv, validateImportRows } from "@/lib/catalog/csv";

const HEADER = [...IMPORT_COLUMNS];

function row(overrides: Partial<Record<(typeof IMPORT_COLUMNS)[number], string>> = {}): string[] {
  const base: Record<(typeof IMPORT_COLUMNS)[number], string> = {
    product_slug: "sample-scrub-set",
    product_name: "Sample Scrub Set",
    category_slug: "hospital-scrubs",
    short_description: "",
    description: "",
    price: "899",
    compare_at_price: "",
    fabric: "",
    care: "",
    gender: "UNISEX",
    tags: "",
    seo_title: "",
    seo_description: "",
    size: "M",
    color: "Ceil Blue",
    color_hex: "#8FB8DE",
    sku: "DK-SCRSET-SAMPLE-M-CEILBLUE",
    stock: "20",
    variant_active: "yes",
    generate_images: "no",
  };
  return HEADER.map((col) => overrides[col] ?? base[col]);
}

const context = { knownCategorySlugs: new Set(["hospital-scrubs"]), existingSkus: new Set<string>() };

describe("parseCsv / stringifyCsv", () => {
  it("round-trips a simple table", () => {
    const rows = [["a", "b,c", 'd"e'], ["1", "2", "3"]];
    const csv = stringifyCsv(rows);
    const parsed = parseCsv(csv);
    assert.deepEqual(parsed, [["a", "b,c", 'd"e'], ["1", "2", "3"]]);
  });

  it("handles embedded newlines inside quoted fields", () => {
    const csv = 'a,"line1\nline2"\n1,2';
    const parsed = parseCsv(csv);
    assert.deepEqual(parsed, [["a", "line1\nline2"], ["1", "2"]]);
  });
});

describe("validateImportRows", () => {
  it("marks a fully valid row ok", () => {
    const results = validateImportRows([HEADER, row()], context);
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "ok");
    assert.equal(results[0].errors.length, 0);
    assert.ok(results[0].data);
    assert.equal(results[0].data?.price, 899);
  });

  it("flags a missing required field", () => {
    const results = validateImportRows([HEADER, row({ sku: "" })], context);
    assert.equal(results[0].status, "error");
    assert.ok(results[0].errors.some((e) => e.includes('"sku"')));
  });

  it("flags an unknown category_slug", () => {
    const results = validateImportRows([HEADER, row({ category_slug: "not-a-real-category" })], context);
    assert.equal(results[0].status, "error");
    assert.ok(results[0].errors.some((e) => e.includes("Unknown category_slug")));
  });

  it("flags a duplicate sku within the same file", () => {
    const results = validateImportRows([HEADER, row(), row({ size: "L" })], context);
    assert.equal(results[0].status, "ok");
    assert.equal(results[1].status, "error");
    assert.ok(results[1].errors.some((e) => e.includes("Duplicate sku")));
  });

  it("flags price <= 0", () => {
    const results = validateImportRows([HEADER, row({ price: "0" })], context);
    assert.equal(results[0].status, "error");
    assert.ok(results[0].errors.some((e) => e.includes("price must be")));
  });

  it("flags compare_at_price <= price", () => {
    const results = validateImportRows([HEADER, row({ compare_at_price: "500" })], context);
    assert.equal(results[0].status, "error");
    assert.ok(results[0].errors.some((e) => e.includes("compare_at_price must be greater")));
  });

  it("warns (not errors) when a sku already exists in the DB", () => {
    const ctx = { knownCategorySlugs: context.knownCategorySlugs, existingSkus: new Set(["DK-SCRSET-SAMPLE-M-CEILBLUE"]) };
    const results = validateImportRows([HEADER, row()], ctx);
    assert.equal(results[0].status, "warning");
    assert.equal(results[0].errors.length, 0);
  });
});

describe("groupRowsByProduct", () => {
  it("groups rows by product_slug, preserving order", () => {
    const results = validateImportRows(
      [HEADER, row(), row({ size: "L", sku: "DK-SCRSET-SAMPLE-L-CEILBLUE" }), row({ product_slug: "other-product", sku: "DK-OTHER-1" })],
      { knownCategorySlugs: context.knownCategorySlugs, existingSkus: new Set() },
    );
    const grouped = groupRowsByProduct(results.map((r) => r.data!).filter(Boolean));
    assert.equal(grouped.length, 2);
    assert.equal(grouped[0].productSlug, "sample-scrub-set");
    assert.equal(grouped[0].rows.length, 2);
    assert.equal(grouped[1].productSlug, "other-product");
  });
});
