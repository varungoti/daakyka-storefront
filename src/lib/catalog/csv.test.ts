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
    country_of_origin: "",
    net_quantity: "",
    hsn_code: "",
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

  // F-181: dry run must catch what commit would reject.
  it("flags an invalid product_slug the way the product form's own regex would", () => {
    const results = validateImportRows([HEADER, row({ product_slug: "Bad Slug/Ü" })], context);
    assert.equal(results[0].status, "error");
    assert.ok(results[0].errors.some((e) => e.includes("product_slug must use")));
  });

  it("flags an invalid color_hex", () => {
    const results = validateImportRows([HEADER, row({ color_hex: "not-a-hex" })], context);
    assert.equal(results[0].status, "error");
    assert.ok(results[0].errors.some((e) => e.includes("color_hex must look like")));
  });

  it("accepts an empty color_hex (optional column)", () => {
    const results = validateImportRows([HEADER, row({ color_hex: "" })], context);
    assert.equal(results[0].status, "ok");
  });

  it("flags a name longer than the product form's own limit", () => {
    const results = validateImportRows([HEADER, row({ product_name: "x".repeat(201) })], context);
    assert.equal(results[0].status, "error");
    assert.ok(results[0].errors.some((e) => e.includes('"product_name" must be 200 characters or fewer')));
  });

  it("flags more than 30 tags, and a single tag over 50 characters", () => {
    const tooMany = validateImportRows([HEADER, row({ tags: Array.from({ length: 31 }, (_, i) => `tag${i}`).join("|") })], context);
    assert.equal(tooMany[0].status, "error");
    assert.ok(tooMany[0].errors.some((e) => e.includes("at most 30 tags")));

    const tooLong = validateImportRows([HEADER, row({ tags: "x".repeat(51) })], context);
    assert.equal(tooLong[0].status, "error");
    assert.ok(tooLong[0].errors.some((e) => e.includes("longer than 50 characters")));
  });

  it("flags two rows for the same product with the same size+color but different SKUs — the case that used to only 500 at commit", () => {
    const results = validateImportRows(
      [HEADER, row({ sku: "DK-A" }), row({ sku: "DK-B" })],
      context,
    );
    assert.equal(results[0].status, "ok");
    assert.equal(results[1].status, "error");
    assert.ok(results[1].errors.some((e) => e.includes('Duplicate size "M" + color "Ceil Blue"')));
  });

  it("does not flag the same size+color pair across two different products", () => {
    const results = validateImportRows(
      [HEADER, row({ sku: "DK-A" }), row({ product_slug: "other-product", sku: "DK-B" })],
      context,
    );
    assert.equal(results[0].status, "ok");
    assert.equal(results[1].status, "ok");
  });

  // F-191: re-importing an unchanged export must not flag every row.
  it("does not warn when an existing SKU belongs to this same product", () => {
    const ctx = {
      knownCategorySlugs: context.knownCategorySlugs,
      existingSkus: new Set(["DK-SCRSET-SAMPLE-M-CEILBLUE"]),
      skuOwner: new Map([["DK-SCRSET-SAMPLE-M-CEILBLUE", "sample-scrub-set"]]),
    };
    const results = validateImportRows([HEADER, row()], ctx);
    assert.equal(results[0].status, "ok");
  });

  it("still warns when an existing SKU belongs to a different product", () => {
    const ctx = {
      knownCategorySlugs: context.knownCategorySlugs,
      existingSkus: new Set(["DK-SCRSET-SAMPLE-M-CEILBLUE"]),
      skuOwner: new Map([["DK-SCRSET-SAMPLE-M-CEILBLUE", "some-other-product"]]),
    };
    const results = validateImportRows([HEADER, row()], ctx);
    assert.equal(results[0].status, "warning");
    assert.ok(results[0].errors.length === 0);
  });

  // F-191: exportProductsCsv writes one such row for a zero-variant
  // product instead of dropping it from the export entirely.
  it("treats a row with no size/color/sku as a product-only placeholder, not a validation error", () => {
    const placeholder = row({ size: "", color: "", color_hex: "", sku: "", stock: "" });
    const results = validateImportRows([HEADER, placeholder], context);
    assert.equal(results[0].status, "ok");
    assert.equal(results[0].errors.length, 0);
    assert.equal(results[0].data?.hasVariant, false);
  });

  it("still requires size/color/sku together — filling in only one of them is a real error", () => {
    const results = validateImportRows([HEADER, row({ color: "", sku: "" })], context);
    assert.equal(results[0].status, "error");
    assert.ok(results[0].errors.some((e) => e.includes('"color"')));
    assert.ok(results[0].errors.some((e) => e.includes('"sku"')));
  });

  it("marks a normal variant row's data as hasVariant: true", () => {
    const results = validateImportRows([HEADER, row()], context);
    assert.equal(results[0].data?.hasVariant, true);
  });

  it("never throws when the CSV omits an optional boolean column entirely", () => {
    const minimalHeader = ["product_slug", "product_name", "category_slug", "price", "size", "color", "sku"];
    const minimalRow = ["sample-scrub-set", "Sample Scrub Set", "hospital-scrubs", "899", "M", "Ceil Blue", "DK-MIN-1"];
    const results = validateImportRows([minimalHeader, minimalRow], context);
    assert.equal(results[0].status, "ok");
    assert.equal(results[0].data?.variantActive, true);
    assert.equal(results[0].data?.generateImages, false);
  });
});

// F-311: country of origin / net quantity / HSN code travel through CSV
// import and export, so the owner can fill the Legal Metrology and GST
// fields for the whole catalogue in one spreadsheet pass.
describe("compliance columns (F-311)", () => {
  it("are the last three template columns, so every earlier column keeps its position", () => {
    assert.deepEqual(HEADER.slice(-3), ["country_of_origin", "net_quantity", "hsn_code"]);
    assert.equal(HEADER.indexOf("generate_images"), HEADER.length - 4);
  });

  it("are parsed and trimmed onto the row", () => {
    const results = validateImportRows(
      [HEADER, row({ country_of_origin: " India ", net_quantity: "1 set (2 pcs)", hsn_code: "6211" })],
      context,
    );
    assert.equal(results[0].status, "ok");
    assert.equal(results[0].data?.countryOfOrigin, "India");
    assert.equal(results[0].data?.netQuantity, "1 set (2 pcs)");
    assert.equal(results[0].data?.hsnCode, "6211");
  });

  it("a blank cell in a file that has the column is null, which clears the stored value", () => {
    const results = validateImportRows([HEADER, row()], context);
    assert.equal(results[0].data?.countryOfOrigin, null);
    assert.equal(results[0].data?.netQuantity, null);
    assert.equal(results[0].data?.hsnCode, null);
  });

  it("a file without the columns leaves them undefined, so re-importing an older export can't wipe them", () => {
    const olderHeader = HEADER.filter((col) => !["country_of_origin", "net_quantity", "hsn_code"].includes(col));
    const olderRow = row().slice(0, olderHeader.length);
    const results = validateImportRows([olderHeader, olderRow], context);
    assert.equal(results[0].status, "ok");
    assert.equal(results[0].data?.countryOfOrigin, undefined);
    assert.equal(results[0].data?.netQuantity, undefined);
    assert.equal(results[0].data?.hsnCode, undefined);
  });

  it("are held to the same length limits as the product form", () => {
    for (const [column, max] of [
      ["country_of_origin", 100],
      ["net_quantity", 60],
      ["hsn_code", 20],
    ] as const) {
      const ok = validateImportRows([HEADER, row({ [column]: "x".repeat(max) })], context);
      assert.equal(ok[0].status, "ok", `${column} at ${max} characters`);
      const tooLong = validateImportRows([HEADER, row({ [column]: "x".repeat(max + 1) })], context);
      assert.equal(tooLong[0].status, "error", `${column} at ${max + 1} characters`);
      assert.ok(tooLong[0].errors.some((e) => e.includes(`"${column}" must be ${max} characters or fewer`)));
    }
  });

  it("survive an export-shaped CSV round trip (stringify, parse, validate), commas and quotes included", () => {
    const exported = stringifyCsv([
      HEADER,
      row({ country_of_origin: "India", net_quantity: '1 set, 2 pcs ("pair")', hsn_code: "6211" }),
      // A product-only placeholder row (no variants yet) carries them too.
      row({ product_slug: "draft-product", size: "", color: "", color_hex: "", sku: "", stock: "", country_of_origin: "India", net_quantity: "1 N", hsn_code: "6210" }),
    ]);
    const results = validateImportRows(parseCsv(exported), context);
    assert.deepEqual(results.map((result) => result.status), ["ok", "ok"]);
    assert.deepEqual(
      results.map((result) => [result.data?.countryOfOrigin, result.data?.netQuantity, result.data?.hsnCode]),
      [
        ["India", '1 set, 2 pcs ("pair")', "6211"],
        ["India", "1 N", "6210"],
      ],
    );
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
