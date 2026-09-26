import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findExactVariant,
  isSizeAvailableForColor,
  isVariantInStock,
  resolveVariant,
  variantExists,
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

  describe("F-103: a real gap — the size and colour both exist, just not together", () => {
    // S/Red, M/Red, L/Red, S/Blue, L/Blue — no M/Blue row at all.
    const sparse: ProductVariant[] = [
      dbVariant({ id: "s-red", size: "S", color: "Red", stock: 5 }),
      dbVariant({ id: "m-red", size: "M", color: "Red", stock: 3 }),
      dbVariant({ id: "l-red", size: "L", color: "Red", stock: 5 }),
      dbVariant({ id: "s-blue", size: "S", color: "Blue", stock: 2 }),
      dbVariant({ id: "l-blue", size: "L", color: "Blue", stock: 4 }),
    ];

    it("reports the missing combo as unavailable, not merely sold out", () => {
      assert.equal(isSizeAvailableForColor(sparse, "M", "Blue"), false);
    });

    it("still reports a combo that does exist as available", () => {
      assert.equal(isSizeAvailableForColor(sparse, "M", "Red"), true);
      assert.equal(isSizeAvailableForColor(sparse, "S", "Blue"), true);
    });

    it("still returns true for a size that's not a dimension of this product at all (legacy no-data shape)", () => {
      assert.equal(isSizeAvailableForColor(sparse, "XL", "Blue"), true);
    });
  });
});

describe("findExactVariant (F-103)", () => {
  const variants: ProductVariant[] = [
    dbVariant({ id: "s-red", size: "S", color: "Red", stock: 5 }),
    dbVariant({ id: "m-red", size: "M", color: "Red", stock: 3 }),
    dbVariant({ id: "s-blue", size: "S", color: "Blue", stock: 2 }),
  ];

  it("returns the variant that matches both size and colour exactly", () => {
    assert.equal(findExactVariant(variants, "M", "Red")?.id, "m-red");
  });

  it("returns undefined when only a partial match exists — no fallback", () => {
    assert.equal(findExactVariant(variants, "M", "Blue"), undefined);
  });

  it("returns undefined for an empty/undefined variant list", () => {
    assert.equal(findExactVariant(undefined, "M", "Red"), undefined);
    assert.equal(findExactVariant([], "M", "Red"), undefined);
  });
});

describe("variantExists (F-103/F-107)", () => {
  const sparse: ProductVariant[] = [
    dbVariant({ id: "s-red", size: "S", color: "Red", stock: 5 }),
    dbVariant({ id: "m-red", size: "M", color: "Red", stock: 0 }),
    dbVariant({ id: "s-blue", size: "S", color: "Blue", stock: 2 }),
  ];

  it("is true for a combo that exists, whether in stock or sold out", () => {
    assert.equal(variantExists(sparse, "S", "Red"), true);
    assert.equal(variantExists(sparse, "M", "Red"), true); // sold out, but a real row
  });

  it("is false for a combo that never existed, when both dimensions are known", () => {
    assert.equal(variantExists(sparse, "M", "Blue"), false);
  });

  it("is true when the product has no variant data, or the dimension isn't tracked", () => {
    assert.equal(variantExists(undefined, "M", "Blue"), true);
    assert.equal(variantExists(sparse, "XL", "Blue"), true);
  });
});
