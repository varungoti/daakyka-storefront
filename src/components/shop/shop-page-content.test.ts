import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildActiveFilterChips, isCategoryActiveFacet } from "@/components/shop/shop-page-content";
import { defaultShopFilters, type ShopFilters } from "@/lib/shop/filters";
import { createUrlEchoGuard, OWN_WRITE_ECHO_WINDOW_MS, sameShopFilters } from "@/lib/shop/url-sync";

/**
 * release-hardening audit F-100: the mobile filter drawer (and, on desktop,
 * the toolbar) had no way to see which facets were active once you'd
 * picked them — no chips, no "Clear all" outside the zero-results state.
 * These two pure functions (pulled out of the component for exactly this
 * reason — this repo has no jsdom/React Testing Library) are what render
 * the chip row and the drawer's active-count badge/"Clear all" button.
 */

function noop() {}

const baseFilters: ShopFilters = { ...defaultShopFilters };

describe("isCategoryActiveFacet", () => {
  it("is false with no category selected", () => {
    assert.equal(isCategoryActiveFacet({ ...baseFilters }, undefined), false);
  });

  it("is true on /shop once a category is picked (no initialCategory pin)", () => {
    assert.equal(isCategoryActiveFacet({ ...baseFilters, category: "scrub-sets" }, undefined), true);
  });

  it("is false on /category/[slug] when the filter still matches the page's own pin", () => {
    // F-100 pitfall: initialCategory scopes the whole page — it isn't a
    // facet the shopper picked, so it must never count as "active".
    assert.equal(
      isCategoryActiveFacet({ ...baseFilters, category: "scrub-sets" }, "scrub-sets"),
      false,
    );
  });

  it("is true on /category/[slug] once the shopper picks a *different* category", () => {
    assert.equal(
      isCategoryActiveFacet({ ...baseFilters, category: "kids-wear" }, "scrub-sets"),
      true,
    );
  });
});

describe("buildActiveFilterChips", () => {
  const helpers = {
    categoryName: (slug: string) => (slug === "scrub-sets" ? "Scrub Sets" : slug),
    fabricLabel: (id: string) => (id === "4-way-stretch" ? "4-Way Stretch" : id),
    formatPrice: (amount: number) => `₹${amount}`,
  };

  it("returns no chips for the untouched default filters", () => {
    const chips = buildActiveFilterChips({
      filters: { ...baseFilters },
      query: "",
      initialCategory: undefined,
      ...helpers,
      setFilters: noop,
      setQuery: noop,
    });
    assert.deepEqual(chips, []);
  });

  it("builds one labelled chip per active facet, in a stable order", () => {
    const filters: ShopFilters = {
      ...baseFilters,
      category: "scrub-sets",
      colors: ["Midnight Navy"],
      sizes: ["M", "L"],
      fabrics: ["4-way-stretch"],
      priceMax: 3000,
      onSale: true,
      inStock: true,
    };

    const chips = buildActiveFilterChips({
      filters,
      query: "hoodie",
      initialCategory: undefined,
      ...helpers,
      setFilters: noop,
      setQuery: noop,
    });

    assert.deepEqual(
      chips.map((chip) => chip.label),
      [
        "Scrub Sets",
        "Midnight Navy",
        "Size M",
        "Size L",
        "4-Way Stretch",
        "Up to ₹3000",
        "On sale",
        "In stock",
        '"hoodie"',
      ],
    );
  });

  it("omits the category chip when it only matches the page's own initialCategory pin", () => {
    const chips = buildActiveFilterChips({
      filters: { ...baseFilters, category: "scrub-sets" },
      query: "",
      initialCategory: "scrub-sets",
      ...helpers,
      setFilters: noop,
      setQuery: noop,
    });
    assert.deepEqual(chips, []);
  });

  it("removing the category chip falls back to initialCategory, never to no category at all", () => {
    let updated: ShopFilters | undefined;
    const filters: ShopFilters = { ...baseFilters, category: "kids-wear" };
    const chips = buildActiveFilterChips({
      filters,
      query: "",
      initialCategory: "scrub-sets",
      ...helpers,
      setFilters: (next) => {
        updated = next;
      },
      setQuery: noop,
    });

    const categoryChip = chips.find((chip) => chip.key.startsWith("category:"));
    assert.ok(categoryChip, "expected a category chip for a category that differs from the page's pin");
    categoryChip!.onRemove();
    assert.equal(updated?.category, "scrub-sets");
  });

  it("removing a colour chip drops only that colour, keeping the others", () => {
    let updated: ShopFilters | undefined;
    const filters: ShopFilters = { ...baseFilters, colors: ["Midnight Navy", "Sage Green"] };
    const chips = buildActiveFilterChips({
      filters,
      query: "",
      initialCategory: undefined,
      ...helpers,
      setFilters: (next) => {
        updated = next;
      },
      setQuery: noop,
    });

    const navyChip = chips.find((chip) => chip.label === "Midnight Navy");
    navyChip!.onRemove();
    assert.deepEqual(updated?.colors, ["Sage Green"]);
  });

  it("removing the search-query chip clears the query, not the facets", () => {
    let clearedQuery: string | undefined;
    const chips = buildActiveFilterChips({
      filters: { ...baseFilters, onSale: true },
      query: "lab coat",
      initialCategory: undefined,
      ...helpers,
      setFilters: noop,
      setQuery: (next) => {
        clearedQuery = next;
      },
    });

    const queryChip = chips.find((chip) => chip.key === "query");
    queryChip!.onRemove();
    assert.equal(clearedQuery, "");
  });
});

/**
 * release-hardening F-015/F-094/F-095: ShopFiltersPanel draws its Color, Size
 * and Price Range blocks only from the `facets` prop (deriveShopFacets), and
 * hides them when it is absent. Both the desktop panel and the mobile drawer
 * must therefore receive it, or /shop silently shows no colour, size or price
 * filter at all. The repo has no jsdom, so pin the wiring at the source level.
 */
describe("shop facet wiring", () => {
  const page = readFileSync("src/components/shop/shop-page-content.tsx", "utf8");
  const drawer = readFileSync("src/components/shop/mobile-filter-drawer.tsx", "utf8");

  it("derives the facets from the loaded products and passes them to the panel and the drawer", () => {
    assert.match(page, /deriveShopFacets\(products, \{ category: filters\.category/);
    assert.equal(page.match(/facets=\{facets\}/g)?.length, 2);
  });

  it("prunes selected colours and sizes when the panel or drawer changes the category", () => {
    assert.equal(page.match(/onChange=\{handleFacetPanelChange\}/g)?.length, 2);
    assert.match(page, /pruneFiltersToFacets\(/);
  });

  it("forwards the facets from the drawer to the panel", () => {
    assert.match(drawer, /facets=\{facets\}/);
  });
});

/**
 * F-018: /shop and /category/[slug] are prerendered, so the page can no longer
 * read ?category=/?q=/facets on the server; ShopPageContent applies the URL
 * after hydration and writes its own changes back with history.pushState. The
 * guard below is what keeps the router's lagging report of those writes from
 * typing over what a shopper has typed since.
 */
describe("createUrlEchoGuard (F-018)", () => {
  function clock(start = 1_000) {
    let now = start;
    return { now: () => now, advance: (ms: number) => (now += ms) };
  }

  it("applies a URL it did not write (a first load, a search-dialog or menu link)", () => {
    const guard = createUrlEchoGuard(clock().now);
    assert.equal(guard.isEcho("q=scrubs"), false);
  });

  it("ignores the echo of its own write, and then goes back to applying URLs", () => {
    const guard = createUrlEchoGuard(clock().now);
    guard.noteOwnWrite("q=scrub");
    assert.equal(guard.isEcho("q=scrub"), true);
    assert.equal(guard.isEcho("q=lab+coat"), false, "the echo has arrived; the next change is a navigation");
  });

  it("ignores an earlier write's late echo while a newer write is pending", () => {
    // Typing "scr": the router reports "sc" after the box already says "scr".
    const guard = createUrlEchoGuard(clock().now);
    guard.noteOwnWrite("q=sc");
    guard.noteOwnWrite("q=scr");
    assert.equal(guard.isEcho("q=sc"), true);
    assert.equal(guard.isEcho("q=scr"), true, "the latest write's own echo");
    assert.equal(guard.isEcho("q=other"), false);
  });

  it("matches the echo whatever way the query string is spelled", () => {
    const guard = createUrlEchoGuard(clock().now);
    guard.noteOwnWrite("q=lab%20coat&sizes=M");
    assert.equal(guard.isEcho("q=lab+coat&sizes=M"), true);
    assert.equal(guard.isEcho("q=lab+coat&sizes=M"), false);
  });

  it("stops ignoring after the window, so a navigation is never swallowed for long", () => {
    const time = clock();
    const guard = createUrlEchoGuard(time.now);
    guard.noteOwnWrite("q=scrub");
    time.advance(OWN_WRITE_ECHO_WINDOW_MS + 1);
    assert.equal(guard.isEcho("q=lab+coat"), false);
    // ...and a write that produced no change at all (no echo ever came) left nothing behind.
    assert.equal(guard.isEcho("q=scrub"), false);
  });

  it("reset() forgets a pending write (back/forward is applied directly)", () => {
    const guard = createUrlEchoGuard(clock().now);
    guard.noteOwnWrite("q=scrub");
    guard.reset();
    assert.equal(guard.isEcho("q=other"), false);
  });
});

describe("sameShopFilters (F-018)", () => {
  it("is true for filters that would write the same URL", () => {
    assert.equal(sameShopFilters({ ...defaultShopFilters }, { ...defaultShopFilters }), true);
    assert.equal(
      sameShopFilters(
        { ...defaultShopFilters, sizes: ["M", "L"], sort: "price-asc" },
        { ...defaultShopFilters, sizes: ["M", "L"], sort: "price-asc" },
      ),
      true,
    );
  });

  it("is false once any facet, the category or the sort differs", () => {
    assert.equal(sameShopFilters(defaultShopFilters, { ...defaultShopFilters, category: "scrub-sets" }), false);
    assert.equal(sameShopFilters(defaultShopFilters, { ...defaultShopFilters, colors: ["Navy"] }), false);
    assert.equal(sameShopFilters(defaultShopFilters, { ...defaultShopFilters, sizes: ["M"] }), false);
    assert.equal(sameShopFilters(defaultShopFilters, { ...defaultShopFilters, priceMax: 1500 }), false);
    assert.equal(sameShopFilters(defaultShopFilters, { ...defaultShopFilters, onSale: true }), false);
    assert.equal(sameShopFilters(defaultShopFilters, { ...defaultShopFilters, inStock: true }), false);
    assert.equal(sameShopFilters(defaultShopFilters, { ...defaultShopFilters, sort: "newest" }), false);
  });

  it("treats the optional flags' absence the same as false", () => {
    const withoutFlags: ShopFilters = {
      colors: [],
      sizes: [],
      fabrics: [],
      priceMax: defaultShopFilters.priceMax,
      sort: defaultShopFilters.sort,
    };
    assert.equal(sameShopFilters(withoutFlags, defaultShopFilters), true);
  });
});

describe("prerendered shop routes (F-018/F-257/F-261)", () => {
  const shopPage = readFileSync("src/app/shop/page.tsx", "utf8");
  const categoryPage = readFileSync("src/app/category/[slug]/page.tsx", "utf8");
  const content = readFileSync("src/components/shop/shop-page-content.tsx", "utf8");
  const grid = readFileSync("src/components/shop/product-grid.tsx", "utf8");

  it("neither route reads searchParams (which would render it on every request)", () => {
    for (const [name, source] of [
      ["/shop", shopPage],
      ["/category/[slug]", categoryPage],
    ] as const) {
      assert.doesNotMatch(source, /searchParams\s*[:}=,)]/, `${name} must not take a searchParams prop`);
      assert.doesNotMatch(source, /await searchParams/, name);
    }
  });

  it("the category route renders on first visit and caches (an empty generateStaticParams)", () => {
    assert.match(categoryPage, /export function generateStaticParams\(\) \{\s*return \[\];\s*\}/);
  });

  it("both routes hand the client slim card products, not the full catalogue objects", () => {
    for (const source of [shopPage, categoryPage]) {
      assert.match(source, /products=\{products\.map\(toShopCardProduct\)\}/);
    }
  });

  it("ShopPageContent reads the URL only inside its own Suspense boundary", () => {
    // useSearchParams() makes the tree up to the nearest boundary client-only
    // on a prerendered route: it must stay in the tiny sync component, not in
    // the component that renders the grid.
    const callSites = content.match(/=\s*useSearchParams\(\)/g) ?? [];
    assert.equal(callSites.length, 1);
    assert.match(content, /function ShopUrlSync\(\{ onSearch \}[^)]*\)[\s\S]*?useSearchParams\(\)/);
    assert.match(content, /<Suspense fallback=\{null\}>\s*<ShopUrlSync onSearch=\{handleRouterSearch\} \/>\s*<\/Suspense>/);
  });

  it("only the listing pages ask ProductGrid to preload their first card (F-261)", () => {
    assert.match(grid, /eagerFirst = false/);
    assert.match(grid, /loadEagerly=\{eagerFirst && index === 0\}/);
    assert.match(content, /<ProductGrid[\s\S]*?eagerFirst\s*\/>/);
    for (const file of [
      "src/components/home/featured-products-grid.tsx",
      "src/app/sale/page.tsx",
      "src/components/category/section-landing-page.tsx",
    ]) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /eagerFirst/, `${file} sits below a hero: no high-priority first image`);
    }
  });
});
