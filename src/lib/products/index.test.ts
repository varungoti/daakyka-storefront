import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTS_CACHE_TAG,
  PUBLIC_STOCK_DISPLAY_CAP,
  productCacheTag,
  publicStockCeiling,
  revalidateProductStockForVariants,
  revalidateProductStockTags,
} from "@/lib/products/index";
import { toPublicSearchProduct } from "@/lib/products/public-search-product";
import type { Product } from "@/lib/types";

/**
 * release-hardening audit F-017: orders, payment verification and admin
 * cancel/restock all mutate stock but never invalidated the cached
 * catalog, so a PDP or listing could keep showing pre-mutation stock
 * indefinitely. revalidateProductStockTags is the exact-tags-and-profiles
 * half of the fix, split out (same pattern as
 * src/lib/homepage/index.ts's revalidateHomepageCache) so it's
 * unit-testable — next/cache's exports can't be spied on directly (see
 * that module's doc comment for why).
 */
describe("revalidateProductStockTags", () => {
  it("revalidates each product's own tag with { expire: 0 }, then the broad products tag with 'max'", () => {
    const calls: Array<[string, string | { expire: number }]> = [];
    revalidateProductStockTags(["a-line-school-skirt", "box-pleat-school-skirt"], (tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [
      [productCacheTag("a-line-school-skirt"), { expire: 0 }],
      [productCacheTag("box-pleat-school-skirt"), { expire: 0 }],
      [PRODUCTS_CACHE_TAG, "max"],
    ]);
  });

  it("de-duplicates slugs (one order can touch the same product's multiple variants)", () => {
    const calls: Array<[string, string | { expire: number }]> = [];
    revalidateProductStockTags(["wraparound-ot-gown", "wraparound-ot-gown"], (tag, profile) => {
      calls.push([tag, profile]);
    });
    assert.deepEqual(calls, [
      [productCacheTag("wraparound-ot-gown"), { expire: 0 }],
      [PRODUCTS_CACHE_TAG, "max"],
    ]);
  });

  it("is a no-op for an empty slug list — never touches the broad tag either", () => {
    const calls: unknown[] = [];
    revalidateProductStockTags([], (...args) => calls.push(args));
    assert.deepEqual(calls, []);
  });

  it("swallows an error thrown by the injected revalidate function instead of throwing, and still calls the broad tag afterwards", () => {
    const calls: Array<[string, string | { expire: number }]> = [];
    assert.doesNotThrow(() => {
      revalidateProductStockTags(["classic-lab-coat"], (tag, profile) => {
        calls.push([tag, profile]);
        if (profile !== "max") throw new Error("no static generation store in this context");
      });
    });
    assert.deepEqual(calls, [
      [productCacheTag("classic-lab-coat"), { expire: 0 }],
      [PRODUCTS_CACHE_TAG, "max"],
    ]);
  });

  it("defaults to the real next/cache revalidateTag (throws outside a Next request scope, and that throw is caught)", () => {
    // No revalidate argument — exercises the real default. Outside an
    // actual Next.js server there's no static generation store, so the
    // real revalidateTag throws internally; this must not propagate, which
    // is what makes the function safe to call from an order/payment/cancel
    // code path that also runs in plain scripts and tests.
    assert.doesNotThrow(() => {
      revalidateProductStockTags(["classic-lab-coat"]);
    });
  });
});

describe("revalidateProductStockForVariants", () => {
  it("is a no-op for an empty variant id list (never queries the DB)", async () => {
    const calls: unknown[] = [];
    await assert.doesNotReject(
      revalidateProductStockForVariants([], (...args) => calls.push(args)),
    );
    assert.deepEqual(calls, []);
  });
});

// F-031: the PDP's RSC payload and /api/products used to carry every
// variant's exact on-hand `stock` for the whole catalog.
describe("publicStockCeiling (F-031)", () => {
  it("never reports more than the display cap, however much is on hand", () => {
    assert.equal(publicStockCeiling(PUBLIC_STOCK_DISPLAY_CAP + 1), PUBLIC_STOCK_DISPLAY_CAP);
    assert.equal(publicStockCeiling(68), PUBLIC_STOCK_DISPLAY_CAP);
    assert.equal(publicStockCeiling(1_000_000), PUBLIC_STOCK_DISPLAY_CAP);
  });

  it("stays exact below the cap, so the quantity stepper and 'only N left' still work", () => {
    assert.equal(publicStockCeiling(0), 0);
    assert.equal(publicStockCeiling(3), 3);
    assert.equal(publicStockCeiling(PUBLIC_STOCK_DISPLAY_CAP), PUBLIC_STOCK_DISPLAY_CAP);
  });

  it("never reports a negative number", () => {
    assert.equal(publicStockCeiling(-4), 0);
  });
});

describe("toPublicSearchProduct (F-031)", () => {
  const product: Product = {
    id: "p1",
    handle: "womens-vneck-scrub-top",
    name: "Women's V-Neck Scrub Top",
    description: "Long plain-text description",
    descriptionHtml: "<p>Long <strong>rich</strong> description</p>",
    colorName: "Ceil Blue",
    price: 899,
    rating: 4.5,
    reviewCount: 3,
    category: "tops",
    colors: [{ name: "Ceil Blue", hex: "#6fa8dc" }],
    sizes: ["S", "M"],
    fabricTech: [],
    image: "/cdn/media/product/a.webp",
    images: [{ url: "/cdn/media/product/a.webp" }],
    variants: [
      {
        id: "v1",
        title: "S / Ceil Blue",
        price: 899,
        available: true,
        selectedOptions: [],
        stock: 20,
      },
    ],
    tags: ["scrubs"],
    categorySlug: "tops",
  };

  it("drops the variants (and their stock), images and descriptions from the public payload", () => {
    const result = toPublicSearchProduct(product);
    assert.equal(result.variants, undefined);
    assert.equal(result.images, undefined);
    assert.equal(result.description, undefined);
    assert.equal(result.descriptionHtml, undefined);
    assert.equal(JSON.stringify(result).includes("stock"), false);
  });

  it("keeps every field the search dialog ranks and renders a result from", () => {
    const result = toPublicSearchProduct(product);
    assert.equal(result.handle, product.handle);
    assert.equal(result.name, product.name);
    assert.equal(result.colorName, product.colorName);
    assert.equal(result.price, product.price);
    assert.equal(result.image, product.image);
    assert.deepEqual(result.colors, product.colors);
    assert.deepEqual(result.tags, product.tags);
    assert.equal(result.categorySlug, product.categorySlug);
  });

  it("does not mutate the product it was given", () => {
    toPublicSearchProduct(product);
    assert.equal(product.variants?.length, 1);
    assert.equal(product.variants?.[0].stock, 20);
  });
});
