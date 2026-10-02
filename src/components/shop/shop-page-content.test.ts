import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildActiveFilterChips, isCategoryActiveFacet } from "@/components/shop/shop-page-content";
import { ShopUrlPendingMask, ShopUrlPendingScript } from "@/components/shop/shop-url-pending";
import {
  applyShopFiltersToSearchParams,
  defaultShopFilters,
  withShopVisibleCount,
  type ShopFilters,
} from "@/lib/shop/filters";
import {
  SHOP_URL_PENDING_ATTR,
  SHOP_URL_PENDING_FAILSAFE_MS,
  SHOP_URL_PENDING_PARAMS,
  SHOP_URL_PENDING_SCRIPT,
  shopSearchNeedsUrlSync,
} from "@/lib/shop/url-pending";
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

/**
 * F-018 follow-up: a hard load of a filtered listing URL must not paint the
 * unfiltered grid the prerender holds while the page hydrates (measured on a
 * throttled phone: ~2 s of 24 wrong cards, then a jump). The inline script is
 * run here exactly as the browser does — in a sandbox with a fake location and
 * container — so what is asserted is the shipped string, not a re-implementation.
 */
describe("filtered deep links never paint the unfiltered grid (F-018)", () => {
  interface Container {
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
  }

  function runScript(
    search: string,
    overrides: { currentScript?: unknown; URLSearchParams?: unknown } = {},
  ) {
    const attributes = new Map<string, string>();
    const timers: { run: () => void; ms: number }[] = [];
    const container: Container = {
      setAttribute: (name, value) => void attributes.set(name, value),
      removeAttribute: (name) => void attributes.delete(name),
    };
    const sandbox = {
      location: { search },
      document: {
        currentScript:
          "currentScript" in overrides ? overrides.currentScript : { parentElement: container },
      },
      URLSearchParams: "URLSearchParams" in overrides ? overrides.URLSearchParams : URLSearchParams,
      setTimeout: (run: () => void, ms: number) => {
        timers.push({ run, ms });
        return timers.length;
      },
    };
    vm.runInNewContext(SHOP_URL_PENDING_SCRIPT, sandbox);
    return { attributes, timers };
  }

  it("marks the container for every param that changes what the grid shows", () => {
    for (const search of [
      "?category=scrub-tops",
      "?q=lab+coat",
      "?colors=navy",
      "?sizes=M,L",
      "?fabrics=antimicrobial",
      "?price=999",
      "?sale=1",
      "?stock=1",
      "?sort=price-asc",
      "?show=48",
      "?utm_source=ads&category=scrub-tops",
    ]) {
      const { attributes } = runScript(search);
      assert.equal(attributes.get(SHOP_URL_PENDING_ATTR), "", search);
      assert.equal(shopSearchNeedsUrlSync(search), true, search);
    }
  });

  it("leaves the grid alone when the URL has nothing for it to apply", () => {
    for (const search of ["", "?", "?utm_source=ads&gclid=abc", "?q=", "?category=&sort=", "?unrelated=1"]) {
      const { attributes, timers } = runScript(search);
      assert.equal(attributes.size, 0, `${JSON.stringify(search)} must not hide the grid`);
      assert.equal(timers.length, 0, search);
      assert.equal(shopSearchNeedsUrlSync(search), false, search);
    }
  });

  it("the script and shopSearchNeedsUrlSync agree on every kind of query string", () => {
    for (const search of [
      "",
      "?category=a",
      "?q=",
      "?q=%20",
      "?show=0",
      "?sort=featured",
      "?a=1&b=2",
      "?utm_campaign=sale&sale=1",
    ]) {
      assert.equal(runScript(search).attributes.has(SHOP_URL_PENDING_ATTR), shopSearchNeedsUrlSync(search), search);
    }
  });

  it("lifts the mark by itself after the failsafe delay, so a page that never hydrates still shows its products", () => {
    const { attributes, timers } = runScript("?category=scrub-tops");
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, SHOP_URL_PENDING_FAILSAFE_MS);
    assert.ok(attributes.has(SHOP_URL_PENDING_ATTR));
    timers[0].run();
    assert.equal(attributes.has(SHOP_URL_PENDING_ATTR), false);
    // Long enough for a slow phone to hydrate (~2.6 s measured), short enough
    // that a dead script bundle doesn't leave a blank listing for long.
    assert.ok(SHOP_URL_PENDING_FAILSAFE_MS >= 4000 && SHOP_URL_PENDING_FAILSAFE_MS <= 10000);
  });

  it("can never throw into the page", () => {
    assert.doesNotThrow(() => runScript("?category=a", { currentScript: null }));
    assert.doesNotThrow(() =>
      runScript("?category=a", {
        URLSearchParams: function Broken() {
          throw new Error("no URLSearchParams");
        },
      }),
    );
    assert.equal(runScript("?category=a", { currentScript: null }).attributes.size, 0);
  });

  it("covers exactly the params the page writes to the URL (in step with filters.ts)", () => {
    const everyFacet: ShopFilters = {
      category: "scrub-tops",
      colors: ["navy"],
      sizes: ["M"],
      fabrics: ["antimicrobial"],
      priceMax: 999,
      onSale: true,
      inStock: true,
      sort: "price-asc",
    };
    const written = new Set(applyShopFiltersToSearchParams("", everyFacet, "lab coat").keys());
    for (const key of withShopVisibleCount("", 48).keys()) written.add(key);
    assert.deepEqual([...written].sort(), [...SHOP_URL_PENDING_PARAMS].sort());
  });

  it("renders the script into the static HTML, and the mask as an inert, aria-hidden stand-in", () => {
    const script = renderToStaticMarkup(createElement(ShopUrlPendingScript));
    assert.ok(script.startsWith("<script>") && script.endsWith("</script>"), script);
    assert.ok(script.includes("document.currentScript.parentElement"));
    assert.doesNotMatch(script, /src=/);

    const mask = renderToStaticMarkup(createElement(ShopUrlPendingMask));
    assert.match(mask, /aria-hidden="true"/);
    const variant = SHOP_URL_PENDING_ATTR.replace(/^data-/, "");
    // Shown (and visible, over the container's visibility:hidden) only while marked.
    assert.match(mask, /class="[^"]*\bhidden\b[^"]*"/);
    assert.ok(mask.includes(`group-data-[${variant}]/results:grid`), mask);
    assert.ok(mask.includes(`group-data-[${variant}]/results:visible`), mask);
  });

  it("ShopPageContent wires the container, the script, the mask and the release together", () => {
    const content = readFileSync("src/components/shop/shop-page-content.tsx", "utf8").replace(/\r\n/g, "\n");
    const variant = SHOP_URL_PENDING_ATTR.replace(/^data-/, "");

    // The script is the container's first child: it must run before any card
    // below it is parsed, and it marks `document.currentScript.parentElement`.
    assert.match(
      content,
      /<div\n\s+ref=\{resultsRef\}\n\s+suppressHydrationWarning\n\s+className="group\/results [^"]*"\n\s+>\n\s+\{syncUrl && <ShopUrlPendingScript \/>\}/,
    );
    assert.ok(content.includes(`data-[${variant}]:invisible`), "the marked container is hidden");
    assert.match(content, /\{syncUrl && <ShopUrlPendingMask \/>\}/);

    // Released by the layout-effect callback ShopUrlSync runs after the URL's
    // filters are applied — including when that report is an echo.
    assert.match(
      content,
      /const handleRouterSearch = useCallback\(\s*\(search: string\) => \{\s*if \(!echoGuard\.isEcho\(search\)\) applyUrlSearch\(search\);[\s\S]*?resultsRef\.current\?\.removeAttribute\(SHOP_URL_PENDING_ATTR\);/,
    );
    assert.match(content, /useLayoutEffect\(\(\) => \{\s*onSearch\(search\);/);
  });

  it("the script is rendered by the server and while hydrating, never created by a client-side navigation", () => {
    // React creates an inert script (and development builds log an error for it)
    // when a client-side navigation renders one; a server-rendered one is only
    // hydrated. A client navigation applies its filters before the first paint and
    // so has no use for the script.
    const source = readFileSync("src/components/shop/shop-url-pending.tsx", "utf8").replace(/\r\n/g, "\n");
    assert.match(source, /^"use client";/);
    assert.match(
      source,
      /const clientRender = useSyncExternalStore\(subscribeToNothing, \(\) => true, \(\) => false\);\n\s*if \(clientRender\) return null;\n\s*return <script dangerouslySetInnerHTML/,
    );
  });
});
