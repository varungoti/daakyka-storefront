import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countByCategory,
  defaultShopFilters,
  filterProducts,
} from "@/lib/shop/filters";
import { PRICE_FILTER_MAX_INR } from "@/lib/currency/config";
import type { Product } from "@/lib/types";

const mockProducts: Product[] = [
  {
    id: "1",
    handle: "top-lilac",
    name: "V-Neck Top",
    colorName: "Lilac Purple",
    price: 3999,
    rating: 4.9,
    reviewCount: 100,
    category: "tops",
    colors: [{ name: "Lilac Purple", hex: "#C4B5FD" }],
    sizes: ["M", "L"],
    fabricTech: ["4-way-stretch"],
    image: "/img.jpg",
    badge: "best-seller",
  },
  {
    id: "2",
    handle: "pants-navy",
    name: "Jogger Pants",
    colorName: "Midnight Navy",
    price: 4499,
    rating: 4.8,
    reviewCount: 80,
    category: "bottoms",
    colors: [{ name: "Midnight Navy", hex: "#1E3A5F" }],
    sizes: ["L"],
    fabricTech: ["moisture-wicking"],
    image: "/img2.jpg",
  },
  {
    id: "3",
    handle: "set-sage",
    name: "Scrub Set",
    colorName: "Sage Green",
    price: 7999,
    rating: 4.7,
    reviewCount: 50,
    category: "sets",
    colors: [{ name: "Sage Green", hex: "#86A789" }],
    sizes: ["S"],
    fabricTech: ["4-way-stretch", "anti-microbial"],
    image: "/img3.jpg",
    badge: "new",
  },
];

describe("filterProducts", () => {
  it("filters by category", () => {
    const result = filterProducts(mockProducts, {
      colors: [],
      sizes: [],
      fabrics: [],
      priceMax: 10000,
      sort: "featured",
      category: "tops",
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].handle, "top-lilac");
  });

  it("filters by color name", () => {
    const result = filterProducts(mockProducts, {
      colors: ["Midnight Navy"],
      sizes: [],
      fabrics: [],
      priceMax: 10000,
      sort: "featured",
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].category, "bottoms");
  });

  it("filters by fabric technology", () => {
    const result = filterProducts(mockProducts, {
      colors: [],
      sizes: [],
      fabrics: ["anti-microbial"],
      priceMax: 10000,
      sort: "featured",
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].handle, "set-sage");
  });

  it("filters by max price", () => {
    const result = filterProducts(mockProducts, {
      colors: [],
      sizes: [],
      fabrics: [],
      priceMax: 4000,
      sort: "featured",
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].price, 3999);
  });

  it("sorts by price ascending", () => {
    const result = filterProducts(mockProducts, {
      colors: [],
      sizes: [],
      fabrics: [],
      priceMax: 10000,
      sort: "price-asc",
    });
    assert.deepEqual(
      result.map((p) => p.price),
      [3999, 4499, 7999],
    );
  });

  it("sorts by rating descending", () => {
    const result = filterProducts(mockProducts, {
      colors: [],
      sizes: [],
      fabrics: [],
      priceMax: 10000,
      sort: "rating",
    });
    assert.equal(result[0].rating, 4.9);
  });
});

describe("countByCategory", () => {
  it("counts products per category slug", () => {
    const counts = countByCategory(mockProducts);
    assert.equal(counts.tops, 1);
    assert.equal(counts.bottoms, 1);
    assert.equal(counts.sets, 1);
  });
});

describe("defaultShopFilters (v1 5.5 fix)", () => {
  it("defaults priceMax to the top of the filter's own range, so nothing is hidden until the shopper narrows it", () => {
    assert.equal(defaultShopFilters.priceMax, PRICE_FILTER_MAX_INR);
    // A product priced above the old lower "default max" (8999) must
    // still be visible by default.
    const expensiveProduct: Product = {
      ...mockProducts[0],
      id: "expensive",
      handle: "expensive",
      price: 10499,
    };
    const result = filterProducts([expensiveProduct], defaultShopFilters);
    assert.equal(result.length, 1);
  });
});

describe("filterProducts with category descendants (Phase B3)", () => {
  const hospitalProducts: Product[] = [
    { ...mockProducts[0], id: "scrub-1", handle: "scrub-1", category: "scrub-sets" },
    { ...mockProducts[1], id: "bedsheet-1", handle: "bedsheet-1", category: "bedsheets" },
    { ...mockProducts[2], id: "school-1", handle: "school-1", category: "school-shirts" },
  ];

  const categoryDescendants: Record<string, string[]> = {
    "for-hospitals": ["for-hospitals", "scrub-sets", "hospital-linens", "bedsheets"],
    "scrub-sets": ["scrub-sets"],
    "school-shirts": ["school-shirts"],
  };

  it("matches a parent category's descendants when a descendants map is provided", () => {
    const result = filterProducts(
      hospitalProducts,
      { ...defaultShopFilters, category: "for-hospitals" },
      categoryDescendants,
    );
    assert.equal(result.length, 2);
    assert.deepEqual(
      result.map((p) => p.handle).sort(),
      ["bedsheet-1", "scrub-1"],
    );
  });

  it("still matches an exact leaf category via the descendants map", () => {
    const result = filterProducts(
      hospitalProducts,
      { ...defaultShopFilters, category: "scrub-sets" },
      categoryDescendants,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].handle, "scrub-1");
  });

  it("falls back to an exact-slug match when no descendants map is given", () => {
    const result = filterProducts(hospitalProducts, {
      ...defaultShopFilters,
      category: "for-hospitals",
    });
    assert.equal(result.length, 0, "without a descendants map, 'for-hospitals' matches nothing directly");
  });
});
