import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildActiveFilterChips, isCategoryActiveFacet } from "@/components/shop/shop-page-content";
import { defaultShopFilters, type ShopFilters } from "@/lib/shop/filters";

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
