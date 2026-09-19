import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyShopFiltersToSearchParams,
  countByCategory,
  defaultShopFilters,
  filterProducts,
  parseShopFiltersFromSearchParams,
  parseShopSearchQuery,
  type ShopFilters,
} from "@/lib/shop/filters";
import { PRICE_FILTER_MAX_INR, PRICE_FILTER_MIN_INR } from "@/lib/currency/config";
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

describe("filterProducts: on-sale and in-stock (storefront-ux F5 new facets)", () => {
  const saleAndStockProducts: Product[] = [
    { ...mockProducts[0], id: "sale-1", handle: "sale-1", onSale: true, available: true },
    { ...mockProducts[1], id: "sale-2", handle: "sale-2", onSale: false, available: true },
    { ...mockProducts[2], id: "sale-3", handle: "sale-3", onSale: true, available: false },
  ];

  it("restricts to on-sale products when onSale is true", () => {
    const result = filterProducts(saleAndStockProducts, { ...defaultShopFilters, onSale: true });
    assert.deepEqual(result.map((p) => p.handle).sort(), ["sale-1", "sale-3"]);
  });

  it("restricts to in-stock products when inStock is true", () => {
    const result = filterProducts(saleAndStockProducts, { ...defaultShopFilters, inStock: true });
    assert.deepEqual(result.map((p) => p.handle).sort(), ["sale-1", "sale-2"]);
  });

  it("combines onSale and inStock as AND, not OR", () => {
    const result = filterProducts(saleAndStockProducts, {
      ...defaultShopFilters,
      onSale: true,
      inStock: true,
    });
    assert.deepEqual(result.map((p) => p.handle), ["sale-1"]);
  });

  it("treats a product with `available` left undefined as in stock (matches add-to-cart-button.tsx's `product.available ?? true`)", () => {
    const noAvailableField: Product = { ...mockProducts[0], id: "no-avail", handle: "no-avail" };
    const result = filterProducts([noAvailableField], { ...defaultShopFilters, inStock: true });
    assert.equal(result.length, 1);
  });

  it("is a no-op when both flags are omitted, so pre-F5 ShopFilters literals without them still behave correctly", () => {
    const filtersWithoutNewFields: ShopFilters = {
      category: undefined,
      colors: [],
      sizes: [],
      fabrics: [],
      priceMax: 10000,
      sort: "featured",
    };
    const result = filterProducts(saleAndStockProducts, filtersWithoutNewFields);
    assert.equal(result.length, 3);
  });
});

// ---------------------------------------------------------------------------
// URL <-> ShopFilters (storefront-ux audit F5 / "Full facet→URL sync")
// ---------------------------------------------------------------------------

describe("parseShopFiltersFromSearchParams: round-tripping every facet", () => {
  it("parses category, colors, sizes, fabrics, price, sale, stock, and sort together", () => {
    const params = new URLSearchParams(
      "category=scrub-sets&colors=Midnight+Navy,Sage+Green&sizes=M,L&fabrics=4-way-stretch,anti-microbial&price=6000&sale=1&stock=1&sort=price-asc",
    );
    const filters = parseShopFiltersFromSearchParams(params);
    assert.deepEqual(filters, {
      category: "scrub-sets",
      colors: ["Midnight Navy", "Sage Green"],
      sizes: ["M", "L"],
      fabrics: ["4-way-stretch", "anti-microbial"],
      priceMax: 6000,
      onSale: true,
      inStock: true,
      sort: "price-asc",
    });
  });

  it("returns defaultShopFilters (category undefined) for an empty query string", () => {
    const filters = parseShopFiltersFromSearchParams(new URLSearchParams());
    assert.deepEqual(filters, { ...defaultShopFilters, category: undefined });
  });

  it("falls back to the provided category when the URL has none", () => {
    const filters = parseShopFiltersFromSearchParams(new URLSearchParams(), { category: "kids-wear" });
    assert.equal(filters.category, "kids-wear");
  });

  it("prefers the URL's own category over the fallback when both are present", () => {
    const filters = parseShopFiltersFromSearchParams(new URLSearchParams("category=sets"), {
      category: "tops",
    });
    assert.equal(filters.category, "sets");
  });

  it("never throws for null/undefined params and returns the defaults", () => {
    assert.doesNotThrow(() => parseShopFiltersFromSearchParams(null));
    assert.doesNotThrow(() => parseShopFiltersFromSearchParams(undefined));
    assert.deepEqual(parseShopFiltersFromSearchParams(null), { ...defaultShopFilters, category: undefined });
  });
});

describe("parseShopFiltersFromSearchParams: multi-select facets", () => {
  it("trims whitespace around comma-separated values", () => {
    const filters = parseShopFiltersFromSearchParams(
      new URLSearchParams({ colors: " Midnight Navy , Sage Green " }),
    );
    assert.deepEqual(filters.colors, ["Midnight Navy", "Sage Green"]);
  });

  it("de-duplicates repeated values", () => {
    const filters = parseShopFiltersFromSearchParams(new URLSearchParams({ sizes: "M,L,M,M,L" }));
    assert.deepEqual(filters.sizes, ["M", "L"]);
  });

  it("drops empty tokens from a trailing or doubled comma", () => {
    const filters = parseShopFiltersFromSearchParams(new URLSearchParams({ sizes: "M,,L," }));
    assert.deepEqual(filters.sizes, ["M", "L"]);
  });

  it("keeps facets independent — an empty/absent one doesn't affect the others", () => {
    const filters = parseShopFiltersFromSearchParams(new URLSearchParams({ fabrics: "eco-flex" }));
    assert.deepEqual(filters.fabrics, ["eco-flex"]);
    assert.deepEqual(filters.colors, []);
    assert.deepEqual(filters.sizes, []);
  });
});

describe("parseShopFiltersFromSearchParams: price range", () => {
  it("parses a valid price within range", () => {
    assert.equal(parseShopFiltersFromSearchParams(new URLSearchParams({ price: "5500" })).priceMax, 5500);
  });

  it("falls back to the default max for a non-numeric price", () => {
    assert.equal(
      parseShopFiltersFromSearchParams(new URLSearchParams({ price: "not-a-number" })).priceMax,
      PRICE_FILTER_MAX_INR,
    );
  });

  it("clamps a price above the filter's max instead of discarding the whole param", () => {
    assert.equal(
      parseShopFiltersFromSearchParams(new URLSearchParams({ price: "999999999" })).priceMax,
      PRICE_FILTER_MAX_INR,
    );
  });

  it("clamps a negative price up to the filter's min", () => {
    assert.equal(
      parseShopFiltersFromSearchParams(new URLSearchParams({ price: "-500" })).priceMax,
      PRICE_FILTER_MIN_INR,
    );
  });

  it("rounds a decimal price", () => {
    assert.equal(parseShopFiltersFromSearchParams(new URLSearchParams({ price: "5500.7" })).priceMax, 5501);
  });
});

describe("parseShopFiltersFromSearchParams: defensive parsing (unknown/malformed/hostile input)", () => {
  it("drops unknown or script/SQLi-lookalike tokens but keeps the valid ones alongside them", () => {
    const filters = parseShopFiltersFromSearchParams(
      new URLSearchParams([
        ["colors", "Midnight Navy,Not A Real Color,<script>alert(1)</script>"],
        ["sizes", "M,XXXXL,DROP TABLE"],
        ["fabrics", "4-way-stretch,not-a-fabric"],
      ]),
    );
    assert.deepEqual(filters.colors, ["Midnight Navy"]);
    assert.deepEqual(filters.sizes, ["M"]);
    assert.deepEqual(filters.fabrics, ["4-way-stretch"]);
  });

  it("ignores an unknown/hostile sort value and falls back to the default", () => {
    const filters = parseShopFiltersFromSearchParams(
      new URLSearchParams([["sort", "'; DROP TABLE products; --"]]),
    );
    assert.equal(filters.sort, "featured");
  });

  it("treats anything other than the literal '1' as false for boolean flags", () => {
    for (const value of ["true", "yes", "on", "0", "false", " 1 ", "11", ""]) {
      const filters = parseShopFiltersFromSearchParams(
        new URLSearchParams([
          ["sale", value],
          ["stock", value],
        ]),
      );
      assert.equal(filters.onSale, false, `sale=${JSON.stringify(value)} should not be truthy`);
      assert.equal(filters.inStock, false, `stock=${JSON.stringify(value)} should not be truthy`);
    }
  });

  it("rejects a category containing characters outside a safe slug charset", () => {
    const filters = parseShopFiltersFromSearchParams(
      new URLSearchParams([["category", "<script>alert(1)</script>"]]),
    );
    assert.equal(filters.category, undefined);
  });

  it("caps an absurdly long multi-value list instead of processing it unbounded", () => {
    const hostileList = Array.from({ length: 5000 }, (_, i) => `x${i}`).join(",");
    const filters = parseShopFiltersFromSearchParams(new URLSearchParams([["colors", hostileList]]));
    assert.equal(filters.colors.length, 0, "none of the generated tokens are real colors");
  });

  it("caps a pathologically long category string instead of crashing", () => {
    const filters = parseShopFiltersFromSearchParams(
      new URLSearchParams([["category", "a".repeat(100_000)]]),
    );
    assert.ok(filters.category === undefined || filters.category.length <= 100);
  });

  it("never throws even if the params object itself throws on .get()", () => {
    const hostileParams = {
      get: (): string => {
        throw new Error("boom");
      },
    };
    assert.doesNotThrow(() => parseShopFiltersFromSearchParams(hostileParams));
    assert.deepEqual(parseShopFiltersFromSearchParams(hostileParams), {
      ...defaultShopFilters,
      category: undefined,
    });
  });

  it("never throws for one query string combining every kind of hostile value at once", () => {
    const junk = new URLSearchParams([
      ["colors", "<script>alert(1)</script>,Midnight Navy"],
      ["sizes", Array.from({ length: 500 }, (_, i) => `bad${i}`).join(",")],
      ["fabrics", "'; DROP TABLE fabrics; --"],
      ["price", "NaN"],
      ["sale", "DROP"],
      ["stock", "💥"],
      ["sort", "../../etc/passwd"],
      ["category", "../../etc/passwd"],
    ]);
    assert.doesNotThrow(() => parseShopFiltersFromSearchParams(junk));
    const filters = parseShopFiltersFromSearchParams(junk);
    assert.deepEqual(filters.colors, ["Midnight Navy"]);
    assert.equal(filters.sizes.length, 0);
    assert.deepEqual(filters.fabrics, []);
    assert.equal(filters.priceMax, PRICE_FILTER_MAX_INR);
    assert.equal(filters.onSale, false);
    assert.equal(filters.inStock, false);
    assert.equal(filters.sort, "featured");
    assert.equal(filters.category, undefined);
  });
});

describe("parseShopSearchQuery", () => {
  it("reads and trims q", () => {
    assert.equal(parseShopSearchQuery(new URLSearchParams({ q: "  navy scrubs  " })), "navy scrubs");
  });

  it("returns an empty string when q is absent", () => {
    assert.equal(parseShopSearchQuery(new URLSearchParams()), "");
  });

  it("caps a pathologically long q instead of crashing or ballooning state", () => {
    const query = parseShopSearchQuery(new URLSearchParams({ q: "x".repeat(10_000) }));
    assert.ok(query.length <= 200);
  });
});

describe("applyShopFiltersToSearchParams", () => {
  const activeFilters: ShopFilters = {
    category: "scrub-sets",
    colors: ["Midnight Navy", "Sage Green"],
    sizes: ["M", "L"],
    fabrics: ["4-way-stretch"],
    priceMax: 6000,
    onSale: true,
    inStock: true,
    sort: "price-asc",
  };

  it("serialises every active facet with the documented human-readable keys", () => {
    const params = applyShopFiltersToSearchParams(new URLSearchParams(), activeFilters, "navy tops");
    assert.equal(params.get("category"), "scrub-sets");
    assert.equal(params.get("q"), "navy tops");
    assert.equal(params.get("colors"), "Midnight Navy,Sage Green");
    assert.equal(params.get("sizes"), "M,L");
    assert.equal(params.get("fabrics"), "4-way-stretch");
    assert.equal(params.get("price"), "6000");
    assert.equal(params.get("sale"), "1");
    assert.equal(params.get("stock"), "1");
    assert.equal(params.get("sort"), "price-asc");
  });

  it("omits every key still at its default, keeping an unfiltered URL clean", () => {
    const params = applyShopFiltersToSearchParams(new URLSearchParams(), defaultShopFilters, "");
    assert.equal(params.toString(), "");
  });

  it("preserves unrelated existing params, e.g. utm campaign tags", () => {
    const params = applyShopFiltersToSearchParams(
      new URLSearchParams({ utm_source: "newsletter" }),
      { ...defaultShopFilters, colors: ["Sage Green"] },
      "",
    );
    assert.equal(params.get("utm_source"), "newsletter");
    assert.equal(params.get("colors"), "Sage Green");
  });

  it("deletes a previously-set key once its facet is cleared", () => {
    const params = applyShopFiltersToSearchParams(
      new URLSearchParams({ colors: "Sage Green", sale: "1" }),
      defaultShopFilters,
      "",
    );
    assert.equal(params.get("colors"), null);
    assert.equal(params.get("sale"), null);
  });

  it("accepts a raw query string as the merge base", () => {
    const params = applyShopFiltersToSearchParams(
      "utm_source=newsletter",
      { ...defaultShopFilters, onSale: true },
      "",
    );
    assert.equal(params.get("utm_source"), "newsletter");
    assert.equal(params.get("sale"), "1");
  });

  it("accepts null as an empty merge base", () => {
    const params = applyShopFiltersToSearchParams(null, { ...defaultShopFilters, inStock: true }, "");
    assert.equal(params.get("stock"), "1");
    assert.equal(Array.from(params.keys()).length, 1);
  });

  it("round-trips with parseShopFiltersFromSearchParams", () => {
    const original: ShopFilters = {
      category: "bottoms",
      colors: ["Charcoal"],
      sizes: ["XL", "2XL"],
      fabrics: ["moisture-wicking", "eco-flex"],
      priceMax: 4200,
      onSale: false,
      inStock: true,
      sort: "newest",
    };
    const params = applyShopFiltersToSearchParams(new URLSearchParams(), original, "joggers");
    assert.deepEqual(parseShopFiltersFromSearchParams(params), original);
    assert.equal(parseShopSearchQuery(params), "joggers");
  });
});

describe("parsed URL filters integrate correctly with filterProducts", () => {
  it("a parsed URL reproduces the same result as manually building the equivalent ShopFilters", () => {
    const params = new URLSearchParams({ colors: "Midnight Navy", price: "10000" });
    const fromUrl = parseShopFiltersFromSearchParams(params);
    // parseShopFiltersFromSearchParams always sets an explicit `category`
    // key (even when undefined), whereas `defaultShopFilters` simply omits
    // it — spelling it out here so the deepEqual below compares the same
    // set of own keys on both sides (Node's assert.deepEqual, unlike a
    // JSON round-trip, treats `{category: undefined}` and `{}` as unequal).
    const direct: ShopFilters = {
      ...defaultShopFilters,
      category: undefined,
      colors: ["Midnight Navy"],
      priceMax: 10000,
    };
    assert.deepEqual(fromUrl, direct);

    const result = filterProducts(mockProducts, fromUrl);
    assert.equal(result.length, 1);
    assert.equal(result[0].handle, "pants-navy");
  });

  it("a hostile/garbage URL still yields a ShopFilters object filterProducts runs without throwing, rendering the full catalog", () => {
    const params = new URLSearchParams({
      colors: "<script>alert(1)</script>",
      price: "not-a-number",
      sort: "'; DROP TABLE --",
    });
    const filters = parseShopFiltersFromSearchParams(params);
    assert.doesNotThrow(() => filterProducts(mockProducts, filters));
    assert.equal(filterProducts(mockProducts, filters).length, mockProducts.length);
  });
});
