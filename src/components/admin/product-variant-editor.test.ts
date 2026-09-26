import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getVariantGridError, type VariantRow } from "@/components/admin/product-variant-editor";

// F-179: getVariantGridError is the single source of truth ProductForm uses
// to block Save *before* ever POSTing the product — see that file's own
// comment. These tests exercise it directly, independent of the React
// component (this repo's unit tests run under Node's test runner with no
// jsdom — see product-view-tracker.test.ts for the same pattern).

function row(overrides: Partial<VariantRow> = {}): VariantRow {
  return { size: "M", color: "Navy", colorHex: "", sku: "DK-M-NAVY", stock: 5, active: true, ...overrides };
}

describe("getVariantGridError", () => {
  it("returns null for a valid, non-empty grid", () => {
    assert.equal(getVariantGridError([row(), row({ size: "L", sku: "DK-L-NAVY" })]), null);
  });

  it("flags a negative stock value", () => {
    const error = getVariantGridError([row({ stock: -1 })]);
    assert.match(error ?? "", /Stock for M \/ Navy must be a whole number/);
  });

  it("flags a non-integer stock value", () => {
    const error = getVariantGridError([row({ stock: 1.5 })]);
    assert.match(error ?? "", /Stock for M \/ Navy must be a whole number/);
  });

  it("flags a zero or negative price override", () => {
    assert.match(getVariantGridError([row({ price: 0 })]) ?? "", /Price override for M \/ Navy must be greater than 0/);
    assert.match(getVariantGridError([row({ price: -50 })]) ?? "", /Price override for M \/ Navy must be greater than 0/);
  });

  it("allows a variant with no price override at all", () => {
    assert.equal(getVariantGridError([row({ price: undefined })]), null);
  });

  it("flags a duplicate size+color pair, case-insensitively", () => {
    const error = getVariantGridError([row({ sku: "DK-1" }), row({ size: "m", color: "navy", sku: "DK-2" })]);
    assert.ok(error);
  });

  it("flags a duplicate SKU across two otherwise-distinct rows", () => {
    const error = getVariantGridError([row({ sku: "DK-SAME" }), row({ size: "L", sku: "DK-SAME" })]);
    assert.ok(error);
  });
});
