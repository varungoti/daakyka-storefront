import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isSizeAvailableForColor,
  isVariantInStock,
  resolveVariant,
} from "@/lib/products/resolve-variant";
import type { ProductVariant } from "@/lib/types";

function dbVariant(overrides: Partial<ProductVariant>): ProductVariant {
  return {
    id: "v1",
    title: "M / Navy",
    price: 500,
    available: true,
    selectedOptions: [
      { name: "Size", value: "M" },
      { name: "Color", value: "Navy" },
    ],
    size: "M",
    color: "Navy",
    stock: 5,
    ...overrides,
  };
}

describe("resolveVariant", () => {
  const variants: ProductVariant[] = [
    dbVariant({ id: "s-navy", size: "S", color: "Navy", stock: 0 }),
    dbVariant({ id: "m-navy", size: "M", color: "Navy", stock: 5 }),
    dbVariant({ id: "m-wine", size: "M", color: "Wine", stock: 3 }),
    dbVariant({ id: "l-wine", size: "L", color: "Wine", stock: 0 }),
  ];

  it("resolves the exact size+colour match", () => {
    const result = resolveVariant(variants, "M", "Wine");
    assert.equal(result?.id, "m-wine");
  });

  it("falls back to a size-only match when the exact combo doesn't exist", () => {
    const result = resolveVariant(variants, "S", "Wine");
    // No S/Wine variant — falls back to whichever variant matches the size.
    assert.equal(result?.id, "s-navy");
  });

  it("falls back to the first variant when neither size nor colour is given", () => {
    assert.equal(resolveVariant(variants, undefined, undefined)?.id, "s-navy");
  });

  it("returns undefined for an empty/undefined variant list", () => {
    assert.equal(resolveVariant(undefined, "M", "Navy"), undefined);
    assert.equal(resolveVariant([], "M", "Navy"), undefined);
  });

  it("matches via selectedOptions for variants without size/color fields (Shopify/legacy)", () => {
    const legacy: ProductVariant = {
      id: "legacy-1",
      title: "Large / Blue",
      price: 400,
      available: true,
      selectedOptions: [
        { name: "Size", value: "L" },
        { name: "Color", value: "Blue" },
      ],
    };
    const result = resolveVariant([legacy], "L", "Blue");
    assert.equal(result?.id, "legacy-1");
  });
});

describe("isVariantInStock", () => {
  it("is false for an undefined variant", () => {
    assert.equal(isVariantInStock(undefined), false);
  });

  it("uses stock for DB-backed variants even if active", () => {
    assert.equal(isVariantInStock(dbVariant({ stock: 0, available: false })), false);
    assert.equal(isVariantInStock(dbVariant({ stock: 5, available: true })), true);
  });

  it("falls back to `available` when stock isn't tracked (Shopify/legacy)", () => {
    const legacy: ProductVariant = {
      id: "legacy-2",
      title: "M",
      price: 400,
      available: true,
      selectedOptions: [],
    };
    assert.equal(isVariantInStock(legacy), true);
    assert.equal(isVariantInStock({ ...legacy, available: false }), false);
  });
});

describe("isSizeAvailableForColor", () => {
  const variants: ProductVariant[] = [
    dbVariant({ id: "s-navy", size: "S", color: "Navy", stock: 0, available: false }),
    dbVariant({ id: "m-navy", size: "M", color: "Navy", stock: 5, available: true }),
    dbVariant({ id: "l-navy", size: "L", color: "Navy", stock: 0, available: false }),
  ];

  it("returns true when the product has no variant data at all", () => {
    assert.equal(isSizeAvailableForColor(undefined, "S", "Navy"), true);
    assert.equal(isSizeAvailableForColor([], "S", "Navy"), true);
  });

  it("returns false for a size/colour combo that's out of stock", () => {
    assert.equal(isSizeAvailableForColor(variants, "S", "Navy"), false);
    assert.equal(isSizeAvailableForColor(variants, "L", "Navy"), false);
  });

  it("returns true for a size/colour combo that's in stock", () => {
    assert.equal(isSizeAvailableForColor(variants, "M", "Navy"), true);
  });

  it("returns true (rather than falsely disabling) when no variant matches that size at all", () => {
    assert.equal(isSizeAvailableForColor(variants, "XL", "Navy"), true);
  });
});
