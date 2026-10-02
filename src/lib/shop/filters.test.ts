import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyShopFiltersToSearchParams,
  countByCategory,
  defaultShopFilters,
  deriveColorFacet,
  derivePriceFacet,
  deriveShopFacets,
  deriveSizeFacet,
  filterProducts,
  isFacetToken,
  parseShopFiltersFromSearchParams,
  parseShopSearchQuery,
  parseShopVisibleCount,
  pruneFiltersToFacets,
  SHOP_PAGE_SIZE,
  withShopVisibleCount,
  type ShopFilters,
} from "@/lib/shop/filters";
import { draftProducts } from "@/data/catalog/draft-catalog";
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

  // release-hardening audit F-096: "Newest" used to sort purely on the
  // admin-set `isNew` flag, so an older isNew=true product outranked a
  // just-created product with the flag left unchecked.
  it("sorts by createdAt descending, not just the isNew flag", () => {
    const products = [
      { ...mockProducts[0], id: "old-new", createdAt: "2026-01-01T00:00:00.000Z", isNew: true },
      { ...mockProducts[1], id: "newest", createdAt: "2026-09-25T00:00:00.000Z", isNew: false },
      { ...mockProducts[2], id: "middle", createdAt: "2026-06-01T00:00:00.000Z", isNew: false },
    ];
    const result = filterProducts(products, {
      colors: [],
      sizes: [],
      fabrics: [],
      priceMax: 10000,
      sort: "newest",
    });
    assert.deepEqual(
      result.map((p) => p.id),
      ["newest", "middle", "old-new"],
    );
  });

  it("newest sort falls back to isNew only to break a tie on identical createdAt", () => {
    const products = [
      { ...mockProducts[0], id: "a", createdAt: "2026-01-01T00:00:00.000Z", isNew: false },
      { ...mockProducts[1], id: "b", createdAt: "2026-01-01T00:00:00.000Z", isNew: true },
    ];
    const result = filterProducts(products, {
      colors: [],
      sizes: [],
      fabrics: [],
      priceMax: 10000,
      sort: "newest",
    });
    assert.deepEqual(
      result.map((p) => p.id),
      ["b", "a"],
    );
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

describe("defaultShopFilters (v1 5.5 / F-094 fix)", () => {
  it("defaults priceMax to 'no limit', so nothing is hidden until the shopper narrows it", () => {
    assert.equal(defaultShopFilters.priceMax, Number.POSITIVE_INFINITY);
    // However dear a product is, it must still be visible by default —
    // the old fixed default (10,999) hid anything above it.
    for (const price of [10499, 10999.5, 250_000]) {
      const expensiveProduct: Product = {
        ...mockProducts[0],
        id: "expensive",
        handle: "expensive",
        price,
      };
      const result = filterProducts([expensiveProduct], defaultShopFilters);
      assert.equal(result.length, 1, `a product priced ${price} must be listed by default`);
    }
  });
});

describe("filterProducts: colour and size matching is case-insensitive", () => {
  const navyShirt: Product = {
    ...mockProducts[0],
    id: "navy-shirt",
    handle: "navy-shirt",
    colors: [{ name: "navy", hex: "#1E3A5F" }],
    sizes: ["2-3Y", "xl"],
  };

  it("matches a colour whatever its case or surrounding whitespace", () => {
    for (const wanted of ["Navy", "NAVY", " navy "]) {
      const result = filterProducts([navyShirt], { ...defaultShopFilters, colors: [wanted] });
      assert.equal(result.length, 1, `colors=${JSON.stringify(wanted)}`);
    }
  });

  it("matches a size whatever its case", () => {
    const result = filterProducts([navyShirt], { ...defaultShopFilters, sizes: ["XL"] });
    assert.equal(result.length, 1);
  });

  it("still excludes a product that doesn't have the colour or size", () => {
    assert.equal(filterProducts([navyShirt], { ...defaultShopFilters, colors: ["Maroon"] }).length, 0);
    assert.equal(filterProducts([navyShirt], { ...defaultShopFilters, sizes: ["3XL"] }).length, 0);
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

  it("falls back to the default (no limit) for a non-numeric price", () => {
    assert.equal(
      parseShopFiltersFromSearchParams(new URLSearchParams({ price: "not-a-number" })).priceMax,
      defaultShopFilters.priceMax,
    );
  });

  // F-094: a price below the old fixed slider minimum (2,499) used to be
  // silently raised to it, so "under INR 500" could not even be expressed.
  it("keeps a low price as given instead of clamping it up to a fixed minimum", () => {
    for (const [raw, expected] of [
      ["149", 149],
      ["500", 500],
      ["1", 1],
    ] as const) {
      assert.equal(
        parseShopFiltersFromSearchParams(new URLSearchParams({ price: raw })).priceMax,
        expected,
        `price=${raw}`,
      );
    }
  });

  it("keeps a high price as given instead of clamping it to a fixed maximum", () => {
    assert.equal(
      parseShopFiltersFromSearchParams(new URLSearchParams({ price: "25000" })).priceMax,
      25000,
    );
  });

  it("treats an absurdly large price as no limit rather than echoing it back", () => {
    for (const raw of ["999999999", "1e12", "Infinity"]) {
      assert.equal(
        parseShopFiltersFromSearchParams(new URLSearchParams({ price: raw })).priceMax,
        defaultShopFilters.priceMax,
        `price=${raw}`,
      );
    }
  });

  it("treats a zero or negative price as garbage, not as a cap that hides everything", () => {
    for (const raw of ["0", "-500", "-0.4"]) {
      assert.equal(
        parseShopFiltersFromSearchParams(new URLSearchParams({ price: raw })).priceMax,
        defaultShopFilters.priceMax,
        `price=${raw}`,
      );
    }
  });

  it("rounds a decimal price", () => {
    assert.equal(parseShopFiltersFromSearchParams(new URLSearchParams({ price: "5500.7" })).priceMax, 5501);
  });
});

describe("parseShopFiltersFromSearchParams: defensive parsing (unknown/malformed/hostile input)", () => {
  it("drops markup/SQLi-punctuation tokens but keeps the valid ones alongside them", () => {
    const filters = parseShopFiltersFromSearchParams(
      new URLSearchParams([
        ["colors", "Navy,<script>alert(1)</script>,x'; DROP TABLE colors; --"],
        ["sizes", "M,<img src=x onerror=alert(1)>,2-3Y"],
        ["fabrics", "4-way-stretch,not-a-fabric"],
      ]),
    );
    assert.deepEqual(filters.colors, ["Navy"]);
    assert.deepEqual(filters.sizes, ["M", "2-3Y"]);
    assert.deepEqual(filters.fabrics, ["4-way-stretch"]);
  });

  // F-015/F-095: colours and sizes were checked against a fixed list of seed
  // names (Midnight Navy, XXS-5XL), so no real colour or size could ever be
  // deep-linked: ?colors=Navy and ?sizes=2-3Y were silently dropped.
  it("accepts the colours and sizes the catalogue really has, not just a fixed list", () => {
    const filters = parseShopFiltersFromSearchParams(
      new URLSearchParams([
        ["colors", "Navy,Hunter Green,Ceil Blue,Pale Sky"],
        ["sizes", "2-3Y,10-11Y,28,Standard,Made to Measure,King"],
      ]),
    );
    assert.deepEqual(filters.colors, ["Navy", "Hunter Green", "Ceil Blue", "Pale Sky"]);
    assert.deepEqual(filters.sizes, ["2-3Y", "10-11Y", "28", "Standard", "Made to Measure", "King"]);
  });

  it("de-duplicates colours and sizes case-insensitively, keeping the first spelling", () => {
    const filters = parseShopFiltersFromSearchParams(
      new URLSearchParams([
        ["colors", "Navy,navy, NAVY "],
        ["sizes", "xl,XL"],
      ]),
    );
    assert.deepEqual(filters.colors, ["Navy"]);
    assert.deepEqual(filters.sizes, ["xl"]);
  });

  it("drops a colour or size longer than any real one", () => {
    const filters = parseShopFiltersFromSearchParams(
      new URLSearchParams([
        ["colors", `Navy,${"a".repeat(41)}`],
        ["sizes", `M,${"1".repeat(41)}`],
      ]),
    );
    assert.deepEqual(filters.colors, ["Navy"]);
    assert.deepEqual(filters.sizes, ["M"]);
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
    assert.ok(filters.colors.length <= 25, `kept ${filters.colors.length} of 5000 tokens`);
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
      ["sizes", Array.from({ length: 500 }, (_, i) => `<bad${i}>`).join(",")],
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
    assert.equal(filters.priceMax, defaultShopFilters.priceMax);
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

  it("drops a stale ?show= — any filter, sort or search change starts the list over on page one", () => {
    const params = applyShopFiltersToSearchParams(
      new URLSearchParams({ show: "48", utm_source: "newsletter" }),
      { ...defaultShopFilters, onSale: true },
      "",
    );
    assert.equal(params.get("show"), null);
    assert.equal(params.get("sale"), "1");
    assert.equal(params.get("utm_source"), "newsletter");
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

// F-021/F-242: /shop's "Load more" keeps how far a shopper got in ?show= so
// that Back from a product page (which remounts the listing) restores it.
describe("parseShopVisibleCount / withShopVisibleCount", () => {
  it("is one page when ?show= is absent, so an untouched listing is unchanged", () => {
    assert.equal(parseShopVisibleCount(new URLSearchParams()), SHOP_PAGE_SIZE);
    assert.equal(parseShopVisibleCount(null), SHOP_PAGE_SIZE);
    assert.equal(parseShopVisibleCount(undefined), SHOP_PAGE_SIZE);
  });

  it("reads back a valid whole number of pages", () => {
    assert.equal(parseShopVisibleCount(new URLSearchParams({ show: "48" })), 48);
    assert.equal(parseShopVisibleCount(new URLSearchParams({ show: "72" })), 72);
  });

  it("rounds a hand-edited value up to a whole page", () => {
    assert.equal(parseShopVisibleCount(new URLSearchParams({ show: "30" })), 48);
  });

  it("falls back to one page for junk, zero, negative or too-small values", () => {
    for (const show of ["", "abc", "NaN", "Infinity", "-48", "0", "1", String(SHOP_PAGE_SIZE)]) {
      assert.equal(parseShopVisibleCount(new URLSearchParams({ show })), SHOP_PAGE_SIZE, `show=${show}`);
    }
  });

  it("caps a hostile value instead of letting the grid render an unbounded list", () => {
    const capped = parseShopVisibleCount(new URLSearchParams({ show: "1000000" }));
    assert.ok(capped <= 480 + SHOP_PAGE_SIZE, `got ${capped}`);
    assert.equal(capped % SHOP_PAGE_SIZE, 0);
  });

  it("honours a custom page size", () => {
    assert.equal(parseShopVisibleCount(new URLSearchParams({ show: "20" }), 10), 20);
    assert.equal(parseShopVisibleCount(new URLSearchParams({ show: "15" }), 10), 20);
  });

  it("never throws on a non-conforming params object", () => {
    const hostile = {
      get() {
        throw new Error("boom");
      },
    };
    assert.equal(parseShopVisibleCount(hostile), SHOP_PAGE_SIZE);
  });

  it("writes ?show= once the list is longer than a page, leaving every other param alone", () => {
    const params = withShopVisibleCount("category=for-hospitals&utm_source=newsletter", 48);
    assert.equal(params.get("show"), "48");
    assert.equal(params.get("category"), "for-hospitals");
    assert.equal(params.get("utm_source"), "newsletter");
  });

  it("removes ?show= again at one page, so an untouched listing never grows a query string", () => {
    assert.equal(withShopVisibleCount("show=48", SHOP_PAGE_SIZE).toString(), "");
    assert.equal(withShopVisibleCount("", SHOP_PAGE_SIZE).toString(), "");
  });

  it("round-trips with parseShopVisibleCount", () => {
    const params = withShopVisibleCount("", 72);
    assert.equal(parseShopVisibleCount(params), 72);
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

// ---------------------------------------------------------------------------
// Facets derived from the live catalogue (F-015 colour, F-094 price, F-095 size)
// ---------------------------------------------------------------------------

function shopProduct(overrides: Partial<Product> & { id: string }): Product {
  return {
    handle: overrides.id,
    name: overrides.id,
    colorName: "Navy",
    price: 999,
    rating: 0,
    reviewCount: 0,
    category: "scrub-tops",
    colors: [{ name: "Navy", hex: "#1E3A5F" }],
    sizes: ["M"],
    fabricTech: [],
    image: "/img.jpg",
    ...overrides,
  };
}

describe("isFacetToken", () => {
  it("accepts the colour and size names the catalogue really uses", () => {
    for (const value of [
      "Navy",
      "Ceil Blue",
      "Hunter Green",
      "XL",
      "2XL",
      "10-11Y",
      "28",
      "Made to Measure",
      "Black/White",
      "Blue (Light)",
    ]) {
      assert.equal(isFacetToken(value), true, value);
    }
  });

  it("rejects markup, list separators, empty and over-long values", () => {
    for (const value of ["", "<script>", "a,b", "x;y", "'; DROP", "a\nb", "a".repeat(41)]) {
      assert.equal(isFacetToken(value), false, JSON.stringify(value));
    }
  });
});

describe("deriveColorFacet", () => {
  it("lists each real colour once, counting products rather than variants, most common first", () => {
    const products = [
      shopProduct({
        id: "a",
        colors: [
          { name: "Navy", hex: "#1E3A5F" },
          { name: "White", hex: "#F5F5F4" },
        ],
      }),
      shopProduct({ id: "b", colors: [{ name: "Navy", hex: "#1E3A5F" }] }),
      // A product listing the same colour twice still counts once.
      shopProduct({
        id: "c",
        colors: [
          { name: "Navy", hex: "#1E3A5F" },
          { name: "Navy", hex: "#1E3A5F" },
        ],
      }),
      shopProduct({
        id: "d",
        colors: [
          { name: "Maroon", hex: "#7B1E2E" },
          { name: "White", hex: "#F5F5F4" },
        ],
      }),
    ];
    assert.deepEqual(
      deriveColorFacet(products).map((c) => [c.name, c.count]),
      [
        ["Navy", 3],
        ["White", 2],
        ["Maroon", 1],
      ],
    );
  });

  it("merges spellings that differ only by case or whitespace, showing the most common one", () => {
    const products = [
      shopProduct({ id: "a", colors: [{ name: "Navy", hex: "#1E3A5F" }] }),
      shopProduct({ id: "b", colors: [{ name: "navy ", hex: "#1E3A5F" }] }),
      shopProduct({ id: "c", colors: [{ name: "Navy", hex: "#1E3A5F" }] }),
    ];
    assert.deepEqual(deriveColorFacet(products), [{ name: "Navy", hex: "#1e3a5f", count: 3 }]);
  });

  it("skips the 'Default' placeholder colour of a product with no variants", () => {
    const products = [
      shopProduct({ id: "a", colors: [{ name: "Default", hex: "#CBD5E1" }] }),
      shopProduct({ id: "b", colors: [{ name: "Navy", hex: "#1E3A5F" }] }),
    ];
    assert.deepEqual(
      deriveColorFacet(products).map((c) => c.name),
      ["Navy"],
    );
  });

  it("skips a colour name the URL could not carry, so every option survives a reload", () => {
    const products = [
      shopProduct({
        id: "a",
        colors: [
          { name: "Black, Red", hex: "#000000" },
          { name: "Navy", hex: "#1E3A5F" },
        ],
      }),
    ];
    assert.deepEqual(
      deriveColorFacet(products).map((c) => c.name),
      ["Navy"],
    );
  });

  it("uses the most common real hex, ignoring the grey placeholder and malformed values", () => {
    const products = [
      shopProduct({ id: "a", colors: [{ name: "Navy", hex: "#CBD5E1" }] }),
      shopProduct({ id: "b", colors: [{ name: "Navy", hex: "not-a-hex" }] }),
      shopProduct({ id: "c", colors: [{ name: "Navy", hex: "#1F2A44" }] }),
      shopProduct({ id: "d", colors: [{ name: "Navy", hex: "#1F2A44" }] }),
      shopProduct({ id: "e", colors: [{ name: "Navy", hex: "#000080" }] }),
    ];
    assert.equal(deriveColorFacet(products)[0].hex, "#1f2a44");
  });

  it("falls back to the shared palette's hex for a known name, then a neutral grey", () => {
    const products = [
      shopProduct({
        id: "a",
        colors: [
          { name: "Navy", hex: "#CBD5E1" },
          { name: "Some Custom Colour", hex: "#CBD5E1" },
        ],
      }),
    ];
    const byName = Object.fromEntries(deriveColorFacet(products).map((c) => [c.name, c.hex]));
    assert.equal(byName["Navy"], "#1E3A5F");
    assert.equal(byName["Some Custom Colour"], "#CBD5E1");
  });

  it("is empty for no products", () => {
    assert.deepEqual(deriveColorFacet([]), []);
  });
});

describe("deriveSizeFacet", () => {
  it("lists each real size once, in the catalogue's canonical order", () => {
    const products = [
      shopProduct({ id: "adult", sizes: ["2XL", "S", "M", "XL", "L"] }),
      shopProduct({ id: "kids", sizes: ["10-11Y", "2-3Y", "4-5Y"] }),
      shopProduct({ id: "school", sizes: ["28", "22", "24"] }),
      shopProduct({ id: "linen", sizes: ["King", "Single", "Double", "Standard"] }),
      shopProduct({ id: "adult-2", sizes: ["M", "L"] }),
    ];
    assert.deepEqual(
      deriveSizeFacet(products).map((s) => s.value),
      ["S", "M", "L", "XL", "2XL", "2-3Y", "4-5Y", "10-11Y", "22", "24", "28", "Single", "Double", "King", "Standard"],
    );
  });

  it("counts products per size and merges case-only duplicates", () => {
    const products = [
      shopProduct({ id: "a", sizes: ["M", "L"] }),
      shopProduct({ id: "b", sizes: ["m"] }),
      shopProduct({ id: "c", sizes: ["M", "M"] }),
    ];
    assert.deepEqual(deriveSizeFacet(products), [
      { value: "M", count: 3 },
      { value: "L", count: 1 },
    ]);
  });

  it("never offers a size the products don't have (no XXS/XS/4XL/5XL)", () => {
    const sizes = deriveSizeFacet([shopProduct({ id: "a", sizes: ["S", "M", "L"] })]).map((s) => s.value);
    for (const phantom of ["XXS", "XS", "4XL", "5XL"]) assert.ok(!sizes.includes(phantom), phantom);
  });

  it("skips a size the URL could not carry", () => {
    const sizes = deriveSizeFacet([shopProduct({ id: "a", sizes: ["M", "S,M", "<b>L</b>"] })]);
    assert.deepEqual(
      sizes.map((s) => s.value),
      ["M"],
    );
  });
});

describe("derivePriceFacet", () => {
  it("spans the cheapest to the dearest product, ending on a whole number of steps", () => {
    const facet = derivePriceFacet([
      shopProduct({ id: "a", price: 149 }),
      shopProduct({ id: "b", price: 999 }),
      shopProduct({ id: "c", price: 2990 }),
    ]);
    assert.ok(facet);
    assert.equal(facet.min, 149);
    assert.ok(facet.max >= 2990, `max ${facet.max} must reach the dearest product`);
    assert.ok(facet.max - 2990 < facet.step, "max must not overshoot by a whole step");
    assert.equal((facet.max - facet.min) % facet.step, 0, "the top stop must be reachable");
  });

  it("rounds a fractional cheapest price up, so that product is still listed at the lowest stop", () => {
    const facet = derivePriceFacet([
      shopProduct({ id: "a", price: 149.5 }),
      shopProduct({ id: "b", price: 500 }),
    ]);
    assert.ok(facet);
    assert.equal(facet.min, 150);
  });

  it("scales the step to the span, rather than a fixed 1 or 1000", () => {
    const narrow = derivePriceFacet([shopProduct({ id: "a", price: 100 }), shopProduct({ id: "b", price: 180 })]);
    const wide = derivePriceFacet([shopProduct({ id: "a", price: 500 }), shopProduct({ id: "b", price: 90_000 })]);
    assert.ok(narrow && wide);
    assert.ok(narrow.step < wide.step);
  });

  it("is null when there is no range to narrow (no products, one price, or unusable prices)", () => {
    assert.equal(derivePriceFacet([]), null);
    assert.equal(derivePriceFacet([shopProduct({ id: "a", price: 500 })]), null);
    assert.equal(
      derivePriceFacet([shopProduct({ id: "a", price: 500 }), shopProduct({ id: "b", price: 500 })]),
      null,
    );
    assert.equal(
      derivePriceFacet([shopProduct({ id: "a", price: Number.NaN }), shopProduct({ id: "b", price: -5 })]),
      null,
    );
  });
});

describe("deriveShopFacets", () => {
  const products = [
    shopProduct({
      id: "scrub",
      category: "scrub-tops",
      price: 799,
      colors: [
        { name: "Navy", hex: "#1E3A5F" },
        { name: "Wine", hex: "#722F37" },
      ],
      sizes: ["S", "M", "L"],
    }),
    shopProduct({
      id: "kids",
      category: "kids-shirts",
      price: 349,
      colors: [
        { name: "Navy", hex: "#1E3A5F" },
        { name: "Sky Blue", hex: "#AEE1F9" },
      ],
      sizes: ["2-3Y", "4-5Y"],
    }),
    shopProduct({
      id: "linen",
      category: "bedsheets",
      price: 1999,
      colors: [{ name: "White", hex: "#F5F5F4" }],
      sizes: ["Single", "King"],
    }),
  ];
  const descendants = {
    "for-kids": ["for-kids", "kids-shirts"],
    "for-hospitals": ["for-hospitals", "scrub-tops", "bedsheets"],
  };

  it("derives everything from all products when no category is selected", () => {
    const facets = deriveShopFacets(products);
    assert.deepEqual(facets.colors.map((c) => c.name).sort(), ["Navy", "Sky Blue", "White", "Wine"]);
    assert.deepEqual(
      facets.sizes.map((s) => s.value),
      ["S", "M", "L", "2-3Y", "4-5Y", "Single", "King"],
    );
    assert.ok(facets.price);
    assert.equal(facets.price.min, 349);
  });

  it("scopes colours and sizes to the selected category and its sub-categories", () => {
    const kids = deriveShopFacets(products, { category: "for-kids", categoryDescendants: descendants });
    assert.deepEqual(
      kids.sizes.map((s) => s.value),
      ["2-3Y", "4-5Y"],
    );
    assert.deepEqual(kids.colors.map((c) => c.name).sort(), ["Navy", "Sky Blue"]);

    const hospitals = deriveShopFacets(products, {
      category: "for-hospitals",
      categoryDescendants: descendants,
    });
    assert.deepEqual(
      hospitals.sizes.map((s) => s.value),
      ["S", "M", "L", "Single", "King"],
    );
  });

  it("falls back to an exact-slug match without a descendants map, like filterProducts", () => {
    const facets = deriveShopFacets(products, { category: "bedsheets" });
    assert.deepEqual(
      facets.sizes.map((s) => s.value),
      ["Single", "King"],
    );
  });

  it("keeps the price range over all products when a category is selected, so the slider doesn't jump", () => {
    const all = deriveShopFacets(products).price;
    const kids = deriveShopFacets(products, { category: "kids-shirts" }).price;
    assert.deepEqual(kids, all);
  });

  it("drops the colours and sizes a new category has no product in, so a pick can't hide the whole category (F-095)", () => {
    const picked: ShopFilters = {
      ...defaultShopFilters,
      category: "for-kids",
      colors: ["Wine", "navy"],
      sizes: ["M", "2-3y"],
      priceMax: 500,
    };
    const kids = deriveShopFacets(products, { category: "for-kids", categoryDescendants: descendants });
    const pruned = pruneFiltersToFacets(picked, kids);
    // Wine and M exist only outside Kids; Navy and 2-3Y exist there (matched
    // case-insensitively, keeping the spelling the shopper had).
    assert.deepEqual(pruned.colors, ["navy"]);
    assert.deepEqual(pruned.sizes, ["2-3y"]);
    // Everything that isn't a colour or size is carried over untouched.
    assert.equal(pruned.category, "for-kids");
    assert.equal(pruned.priceMax, 500);

    // M is the only size picked and Kids has no M: that used to show "0 Products".
    const onlyM: ShopFilters = { ...defaultShopFilters, category: "for-kids", sizes: ["M"] };
    assert.equal(filterProducts(products, onlyM, descendants).length, 0);
    const reconciled = pruneFiltersToFacets(onlyM, kids);
    assert.deepEqual(reconciled.sizes, []);
    assert.equal(filterProducts(products, reconciled, descendants).length, 1);
  });

  it("returns the very same filters when every selected colour and size is still offered", () => {
    const hospitals = deriveShopFacets(products, {
      category: "for-hospitals",
      categoryDescendants: descendants,
    });
    const filters: ShopFilters = { ...defaultShopFilters, colors: ["Navy", "wine"], sizes: ["S", "King"] };
    assert.equal(pruneFiltersToFacets(filters, hospitals), filters);
    assert.equal(pruneFiltersToFacets(defaultShopFilters, hospitals), defaultShopFilters);
  });
});

// The package's acceptance test: run the derivation over the real launch
// catalogue (the data the DB is seeded from) and check every option against
// the products themselves.
describe("shop facets over the real launch catalogue (F-015, F-094, F-095)", () => {
  const products: Product[] = draftProducts.map((draft) => {
    const colors = new Map<string, string>();
    for (const variant of draft.variants) {
      if (!colors.has(variant.color)) colors.set(variant.color, variant.colorHex);
    }
    return shopProduct({
      id: draft.slug,
      category: draft.categorySlug,
      price: draft.price,
      colors: [...colors].map(([name, hex]) => ({ name, hex })),
      sizes: [...new Set(draft.variants.map((variant) => variant.size))],
    });
  });
  const facets = deriveShopFacets(products);
  const lower = (value: string) => value.trim().toLowerCase();

  it("has a real catalogue to check against", () => {
    assert.ok(products.length >= 20, `only ${products.length} products`);
  });

  it("offers exactly the colours at least one product has, with no seed-era swatches", () => {
    const real = new Set(draftProducts.flatMap((p) => p.variants.map((v) => lower(v.color))));
    const offered = new Set(facets.colors.map((c) => lower(c.name)));
    assert.deepEqual([...offered].sort(), [...real].sort());
    for (const seedColor of [
      "Lilac Purple",
      "Midnight Navy",
      "Sage Green",
      "Cloud White",
      "Rose Blush",
      "Ocean Teal",
      "Warm Sand",
    ]) {
      assert.ok(!offered.has(lower(seedColor)), `${seedColor} is not a catalogue colour`);
    }
  });

  it("offers exactly the sizes at least one product has: kids, school and linen sizes present, phantom sizes absent", () => {
    const real = new Set(draftProducts.flatMap((p) => p.variants.map((v) => lower(v.size))));
    const offered = new Set(facets.sizes.map((s) => lower(s.value)));
    assert.deepEqual([...offered].sort(), [...real].sort());
    for (const phantom of ["xxs", "xs", "4xl", "5xl"]) {
      assert.equal(offered.has(phantom), real.has(phantom), phantom);
    }
    assert.ok(
      facets.sizes.some((s) => /^\d+-\d+y$/i.test(s.value)),
      "an age-band size is offered",
    );
    assert.ok(
      facets.sizes.some((s) => /^\d+$/.test(s.value)),
      "a numeric school size is offered",
    );
  });

  it("gives every colour and size option a count that matches what choosing it returns", () => {
    for (const color of facets.colors) {
      const matched = filterProducts(products, { ...defaultShopFilters, colors: [color.name] });
      assert.ok(matched.length > 0, `${color.name} must not lead to an empty list`);
      assert.equal(matched.length, color.count, `${color.name} count`);
    }
    for (const size of facets.sizes) {
      const matched = filterProducts(products, { ...defaultShopFilters, sizes: [size.value] });
      assert.ok(matched.length > 0, `${size.value} must not lead to an empty list`);
      assert.equal(matched.length, size.count, `${size.value} size count`);
    }
  });

  it("derives the price range from the real minimum and maximum price", () => {
    const prices = products.map((p) => p.price);
    const cheapest = Math.min(...prices);
    const dearest = Math.max(...prices);
    assert.ok(facets.price, "the catalogue spans a price range");
    assert.equal(facets.price.min, Math.ceil(cheapest));
    assert.ok(facets.price.max >= dearest);
    assert.ok(facets.price.max - dearest < facets.price.step);
  });

  it("makes every URL a facet click writes round-trip back to the same selection", () => {
    for (const color of facets.colors) {
      const url = applyShopFiltersToSearchParams("", { ...defaultShopFilters, colors: [color.name] }, "");
      assert.deepEqual(parseShopFiltersFromSearchParams(url).colors, [color.name], color.name);
    }
    for (const size of facets.sizes) {
      const url = applyShopFiltersToSearchParams("", { ...defaultShopFilters, sizes: [size.value] }, "");
      assert.deepEqual(parseShopFiltersFromSearchParams(url).sizes, [size.value], size.value);
    }
  });

  it("a deep link to a real colour narrows the list instead of showing no products (F-015)", () => {
    const top = facets.colors[0];
    const filters = parseShopFiltersFromSearchParams(new URLSearchParams({ colors: top.name.toLowerCase() }));
    const result = filterProducts(products, filters);
    assert.equal(result.length, top.count);
    assert.ok(result.length > 0 && result.length <= products.length);
  });

  it("a low ?price= really narrows the list (F-094)", () => {
    assert.ok(facets.price);
    const cap = facets.price.min + facets.price.step * 4;
    const filters = parseShopFiltersFromSearchParams(new URLSearchParams({ price: String(cap) }));
    assert.equal(filters.priceMax, cap);
    const result = filterProducts(products, filters);
    assert.ok(result.length < products.length, "the cap hides the dearer products");
    assert.ok(result.every((p) => p.price <= cap));
    assert.equal(result.length, products.filter((p) => p.price <= cap).length);
  });
});

describe("price filter URL round-trip with the 'no limit' default", () => {
  it("never writes ?price= for the default, and round-trips a real cap", () => {
    assert.equal(applyShopFiltersToSearchParams("", defaultShopFilters, "").get("price"), null);
    const capped = applyShopFiltersToSearchParams("", { ...defaultShopFilters, priceMax: 500 }, "");
    assert.equal(capped.get("price"), "500");
    assert.equal(parseShopFiltersFromSearchParams(capped).priceMax, 500);
  });
});
