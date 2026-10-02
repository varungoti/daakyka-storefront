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
import { toShopCardProduct } from "@/lib/products/card-product";
import { toPublicSearchProduct } from "@/lib/products/public-search-product";
import { matchProducts } from "@/lib/search/match-products";
import { findExactVariant, isSizeAvailableForColor, resolveVariant } from "@/lib/products/resolve-variant";
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
    const result = toPublicSearchProduct(product) as Record<string, unknown>;
    for (const dropped of ["variants", "images", "description", "descriptionHtml"]) {
      assert.equal(dropped in result, false, `${dropped} must not be published`);
    }
    assert.equal(JSON.stringify(result).includes("stock"), false);
  });

  it("keeps every field the search dialog ranks and renders a result from", () => {
    const result = toPublicSearchProduct(product);
    assert.equal(result.id, product.id);
    assert.equal(result.handle, product.handle);
    assert.equal(result.name, product.name);
    assert.equal(result.colorName, product.colorName);
    assert.equal(result.price, product.price);
    assert.equal(result.image, product.image);
    assert.equal(result.category, product.category);
    assert.equal(result.categorySlug, product.categorySlug);
    assert.deepEqual(result.fabricTech, product.fabricTech);
    assert.deepEqual(result.tags, product.tags);
    // F-013: colour names only — the dialog never draws a swatch.
    assert.deepEqual(result.colors, [{ name: "Ceil Blue" }]);
  });

  it("is a much smaller index than the product it was cut from (F-013)", () => {
    const result = toPublicSearchProduct(product);
    assert.ok(JSON.stringify(result).length < JSON.stringify(product).length / 2);
  });

  it("still finds the product by name, colour, category and tag once slimmed", () => {
    const slim = [toPublicSearchProduct(product)];
    for (const query of ["v-neck", "ceil blue", "scrubs", "tops", "women scrub tops"]) {
      assert.equal(matchProducts(slim, query).length, 1, `"${query}" should still match`);
    }
    assert.equal(matchProducts(slim, "kids hoodie").length, 0);
  });

  it("does not mutate the product it was given", () => {
    toPublicSearchProduct(product);
    assert.equal(product.variants?.length, 1);
    assert.equal(product.variants?.[0].stock, 20);
  });
});

// F-257: what /shop and /category/[slug] hand to the client.
describe("toShopCardProduct (F-257)", () => {
  const variant = (size: string, color: string, stock: number) => ({
    id: `v-${size}-${color}`,
    title: `${size} / ${color}`,
    price: 899,
    compareAtPrice: 1199,
    available: stock > 0,
    selectedOptions: [
      { name: "Size", value: size },
      { name: "Color", value: color },
    ],
    stock,
    size,
    color,
    colorHex: color === "Navy" ? "#1E3A5F" : "#6fa8dc",
  });

  const product: Product = {
    id: "p1",
    handle: "womens-vneck-scrub-top",
    name: "Women V-Neck Scrub Top",
    description: "Long plain-text description",
    descriptionHtml: "<p>Long <strong>rich</strong> description</p>",
    shortDescription: "Short teaser",
    colorName: "Ceil Blue",
    price: 899,
    compareAtPrice: 1199,
    rating: 4.5,
    reviewCount: 3,
    ratingAverage: 4.5,
    category: "tops",
    categorySlug: "tops",
    categoryName: "Tops",
    section: "HOSPITAL",
    colors: [
      { name: "Ceil Blue", hex: "#6fa8dc" },
      { name: "Navy", hex: "#1E3A5F" },
    ],
    sizes: ["S", "M"],
    fabricTech: ["4-way-stretch"],
    image: "/cdn/media/product/a.webp",
    images: [
      { url: "/cdn/media/product/a.webp", alt: "front", color: "Ceil Blue", size: "S", appliesToAllSizes: true },
      { url: "/cdn/media/product/a-back.webp", alt: "back", color: "Ceil Blue" },
      { url: "/cdn/media/product/b.webp", alt: "navy", color: "Navy" },
      { url: "/placeholder-product.svg", alt: "shared" },
    ],
    variants: [variant("S", "Ceil Blue", 20), variant("M", "Ceil Blue", 0), variant("S", "Navy", 4)],
    defaultVariantId: "v-S-Ceil Blue",
    available: true,
    onSale: true,
    isNew: false,
    featured: true,
    tags: ["scrubs"],
    gender: "women",
    fabric: "Poly-cotton",
    care: "Machine wash",
    countryOfOrigin: "India",
    netQuantity: "1 N",
    hsnCode: "6211",
    seoTitle: "SEO title",
    seoDescription: "SEO description",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    badge: "best-seller",
  };

  it("drops everything a listing card never reads", () => {
    const card = toShopCardProduct(product) as unknown as Record<string, unknown>;
    for (const dropped of [
      "description",
      "descriptionHtml",
      "shortDescription",
      "ratingAverage",
      "gender",
      "fabric",
      "care",
      "countryOfOrigin",
      "netQuantity",
      "hsnCode",
      "seoTitle",
      "seoDescription",
      "updatedAt",
      "featured",
    ]) {
      assert.equal(dropped in card, false, `${dropped} should not be sent to the listing`);
    }
  });

  it("keeps what the card, the filters, the sorts and the search read", () => {
    const card = toShopCardProduct(product);
    assert.equal(card.id, product.id);
    assert.equal(card.handle, product.handle);
    assert.equal(card.name, product.name);
    assert.equal(card.colorName, product.colorName);
    assert.equal(card.price, product.price);
    assert.equal(card.compareAtPrice, product.compareAtPrice);
    assert.equal(card.rating, product.rating);
    assert.equal(card.reviewCount, product.reviewCount);
    assert.equal(card.category, product.category);
    assert.equal(card.categoryName, product.categoryName);
    assert.equal(card.section, product.section);
    assert.deepEqual(card.colors, product.colors);
    assert.deepEqual(card.sizes, product.sizes);
    assert.deepEqual(card.fabricTech, product.fabricTech);
    assert.equal(card.image, product.image);
    assert.equal(card.badge, product.badge);
    assert.equal(card.defaultVariantId, product.defaultVariantId);
    assert.equal(card.available, true);
    assert.equal(card.onSale, true);
    assert.equal(card.isNew, false);
    assert.deepEqual(card.tags, product.tags);
    assert.equal(card.createdAt, product.createdAt);
  });

  it("leaves a key with no value out entirely instead of sending an explicit undefined", () => {
    const card = toShopCardProduct({ ...product, compareAtPrice: undefined, badge: undefined });
    assert.equal("compareAtPrice" in card, false);
    assert.equal("badge" in card, false);
  });

  it("keeps one preview image per colour (the one the card swatch picks) and nothing else", () => {
    const card = toShopCardProduct(product);
    assert.deepEqual(card.images, [
      { url: "/cdn/media/product/a.webp", color: "Ceil Blue" },
      { url: "/cdn/media/product/b.webp", color: "Navy" },
    ]);
    // ProductCard's swatch: images.find((img) => img.color === color.name).
    for (const color of product.colors) {
      assert.equal(
        card.images?.find((img) => img.color === color.name)?.url,
        product.images?.find((img) => img.color === color.name)?.url,
      );
    }
  });

  it("leaves a product with no images array without one", () => {
    const card = toShopCardProduct({ ...product, images: undefined });
    assert.equal("images" in card, false);
  });

  it("compacts each variant to what Quick Add resolves and adds with, and resolves identically", () => {
    const card = toShopCardProduct(product);
    assert.deepEqual(card.variants?.[0], {
      id: "v-S-Ceil Blue",
      title: "S / Ceil Blue",
      price: 899,
      available: true,
      selectedOptions: [],
      stock: 20,
      size: "S",
      color: "Ceil Blue",
    });
    // Same answers from the slim variants as from the full ones.
    for (const size of product.sizes) {
      for (const color of product.colors.map((c) => c.name)) {
        assert.equal(
          resolveVariant(card.variants, size, color)?.id,
          resolveVariant(product.variants, size, color)?.id,
        );
        assert.equal(
          findExactVariant(card.variants, size, color)?.id,
          findExactVariant(product.variants, size, color)?.id,
        );
        assert.equal(
          isSizeAvailableForColor(card.variants, size, color),
          isSizeAvailableForColor(product.variants, size, color),
        );
      }
    }
  });

  it("keeps selectedOptions for a legacy variant that has no size/color to match on", () => {
    const legacy = {
      id: "gid://1",
      title: "M / Red",
      price: 500,
      available: true,
      selectedOptions: [
        { name: "Size", value: "M" },
        { name: "Color", value: "Red" },
      ],
    };
    const card = toShopCardProduct({ ...product, variants: [legacy] });
    assert.deepEqual(card.variants?.[0].selectedOptions, legacy.selectedOptions);
    assert.equal(resolveVariant(card.variants, "M", "Red")?.id, "gid://1");
  });

  it("does not mutate the product it was given", () => {
    const before = JSON.stringify(product);
    toShopCardProduct(product);
    assert.equal(JSON.stringify(product), before);
  });

  it("is markedly smaller serialized (60 products, ~9 variants each; measured 202 KB -> 120 KB on the seeded catalogue)", () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...product,
      id: `p${index}`,
      variants: Array.from({ length: 9 }, (_, v) => variant(`S${v}`, v % 2 ? "Navy" : "Ceil Blue", 5)),
    }));
    const full = JSON.stringify(many).length;
    const slim = JSON.stringify(many.map(toShopCardProduct)).length;
    assert.ok(slim < full * 0.65, `expected < 65% of ${full} bytes, got ${slim}`);
  });
});
