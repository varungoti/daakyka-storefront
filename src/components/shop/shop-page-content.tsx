"use client";

import { MobileFilterDrawer } from "@/components/shop/mobile-filter-drawer";
import { ProductGrid, type ActiveFilterChip } from "@/components/shop/product-grid";
import { ShopFiltersPanel, type ShopFilterCategory } from "@/components/shop/shop-filters-panel";
import {
  ShopFeatureCards,
  ShopMixMatchPromo,
} from "@/components/shop/shop-feature-cards";
import { TrustBar } from "@/components/layout/trust-bar";
import { useCurrency } from "@/context/currency-provider";
import { fabricFilters } from "@/data/navigation";
import { matchProducts } from "@/lib/search/match-products";
import {
  applyShopFiltersToSearchParams,
  countByCategory,
  defaultShopFilters,
  filterProducts,
  parseShopFiltersFromSearchParams,
  parseShopSearchQuery,
  parseShopVisibleCount,
  withShopVisibleCount,
  type ShopFilters,
} from "@/lib/shop/filters";
import type { CategoryTreeNode } from "@/lib/products";
import type { Product } from "@/lib/types";
import type { Testimonial } from "@/lib/types";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

function flattenSlugs(node: CategoryTreeNode): string[] {
  return [node.slug, ...node.children.flatMap(flattenSlugs)];
}

/** Maps every category slug in the tree (at any depth) to itself plus
 * every one of its descendant slugs, so filtering by a top-level
 * category (e.g. "for-hospitals") also matches products filed under its
 * sub-categories. */
function buildCategoryDescendants(categories: CategoryTreeNode[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  const visit = (node: CategoryTreeNode) => {
    map[node.slug] = flattenSlugs(node);
    node.children.forEach(visit);
  };
  categories.forEach(visit);
  return map;
}

/** Whether the selected category is a facet the shopper picked (and so gets
 * a removable chip / counts as an active filter), as opposed to
 * `initialCategory`, a route-level scope a caller may pin the whole page to
 * (it never counts, and "Clear all" resets back to it). A query-string
 * `?category=` on a page with no pin is always a removable facet. Pulled out
 * as a pure function so it's unit-testable without rendering the component
 * (this repo has no jsdom/React Testing Library — see
 * shop-page-content.test.ts). */
export function isCategoryActiveFacet(filters: ShopFilters, initialCategory?: string): boolean {
  return Boolean(filters.category) && filters.category !== initialCategory;
}

/**
 * F-100: builds one removable chip per active shop-filter facet
 * (category/colour/size/fabric/price/on-sale/in-stock/search query). Takes
 * the filter-mutation callbacks as parameters, rather than reading
 * component state directly, so this is unit-testable with plain stub
 * functions — same reasoning as `isCategoryActiveFacet` above.
 */
export function buildActiveFilterChips(params: {
  filters: ShopFilters;
  query: string;
  initialCategory: string | undefined;
  categoryName: (slug: string) => string;
  fabricLabel: (id: string) => string;
  formatPrice: (amountInInr: number) => string;
  setFilters: (next: ShopFilters) => void;
  setQuery: (next: string) => void;
}): ActiveFilterChip[] {
  const { filters, query, initialCategory, categoryName, fabricLabel, formatPrice, setFilters, setQuery } =
    params;
  const chips: ActiveFilterChip[] = [];

  if (isCategoryActiveFacet(filters, initialCategory) && filters.category) {
    const category = filters.category;
    chips.push({
      key: `category:${category}`,
      label: categoryName(category),
      onRemove: () => setFilters({ ...filters, category: initialCategory }),
    });
  }
  for (const color of filters.colors) {
    chips.push({
      key: `color:${color}`,
      label: color,
      onRemove: () => setFilters({ ...filters, colors: filters.colors.filter((c) => c !== color) }),
    });
  }
  for (const size of filters.sizes) {
    chips.push({
      key: `size:${size}`,
      label: `Size ${size}`,
      onRemove: () => setFilters({ ...filters, sizes: filters.sizes.filter((s) => s !== size) }),
    });
  }
  for (const fabric of filters.fabrics) {
    chips.push({
      key: `fabric:${fabric}`,
      label: fabricLabel(fabric),
      onRemove: () => setFilters({ ...filters, fabrics: filters.fabrics.filter((f) => f !== fabric) }),
    });
  }
  if (filters.priceMax !== defaultShopFilters.priceMax) {
    chips.push({
      key: "price",
      label: `Under ${formatPrice(filters.priceMax)}`,
      onRemove: () => setFilters({ ...filters, priceMax: defaultShopFilters.priceMax }),
    });
  }
  if (filters.onSale) {
    chips.push({
      key: "onSale",
      label: "On sale",
      onRemove: () => setFilters({ ...filters, onSale: false }),
    });
  }
  if (filters.inStock) {
    chips.push({
      key: "inStock",
      label: "In stock",
      onRemove: () => setFilters({ ...filters, inStock: false }),
    });
  }
  if (query.trim()) {
    chips.push({
      key: "query",
      label: `"${query.trim()}"`,
      onRemove: () => setQuery(""),
    });
  }
  return chips;
}

const TestimonialsSection = dynamic(
  () =>
    import("@/components/home/testimonials-section").then((mod) => ({
      default: mod.TestimonialsSection,
    })),
  { loading: () => <div className="min-h-[320px]" aria-hidden /> },
);

// Tried next/dynamic(ssr:false) here too — reverted along with
// CartDrawer/WishlistDrawer/SearchDialog (see site-shell.tsx). Same
// result: MobileFilterDrawer is unconditionally rendered (controlled via
// `open`), so it measured no unused-JS improvement and a worse median LCP.

interface ShopPageHeading {
  eyebrow?: string;
  title: string;
  description?: string;
  breadcrumbLabel?: string;
}

interface ShopPageContentProps {
  products: Product[];
  testimonials: Testimonial[];
  categories?: CategoryTreeNode[];
  initialCategory?: string;
  initialQuery?: string;
  fabricTechEnabled?: boolean;
  mixMatchEnabled?: boolean;
  /** Overrides the default all-apparel hero copy — used by /category/[slug]
   * (Phase C3) to scope this same filterable grid to one category. */
  heading?: ShopPageHeading;
  /** Hides the trust bar / testimonials / feature cards below the grid —
   * used by the narrower /category/[slug] page. Defaults to true (/shop's
   * existing behavior). */
  showExtras?: boolean;
  /** Syncs every filter facet (category, q, colors, sizes, fabrics,
   * price, on-sale, in-stock, sort) to the URL as they change, via
   * shallow `history.pushState`/`replaceState` rather than
   * next/navigation's router (see `applyFilters` below for why) —
   * discrete toggles `pushState`, transient ones (price slider, search
   * box) `replaceState` (Phase C3 fix for v1 5.5; extended for the
   * storefront-ux F5 fix). Defaults to true. */
  syncUrl?: boolean;
  /** Phase E2: the `category.{slug}` manifest slot for this page, resolved
   * via `getSiteImage` by /category/[slug]/page.tsx. `null`/omitted keeps
   * the plain text-only heading band (/shop's existing behavior). */
  headingImage?: { url: string; alt: string } | null;
  /** F-008: the `returns.windowDays` setting, forwarded to TrustBar (only
   * rendered when `showExtras` is true, i.e. on /shop) so its "Easy
   * Returns" claim can't drift from what the PDP/returns/terms pages
   * actually promise. Defaults to 30 — settings/index.ts's own default —
   * only for a caller that predates this prop; /shop/page.tsx always
   * passes the real setting. */
  returnWindowDays?: number;
}

export function ShopPageContent({
  products,
  testimonials,
  categories = [],
  initialCategory,
  initialQuery,
  fabricTechEnabled = false,
  mixMatchEnabled = false,
  heading,
  showExtras = true,
  syncUrl = true,
  headingImage,
  returnWindowDays = 30,
}: ShopPageContentProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { formatPrice } = useCurrency();

  // Phase F5 fix: every facet (colour/size/fabric/price/on-sale/in-stock),
  // not just category/q/sort, is parsed straight from the URL on mount —
  // see src/lib/shop/filters.ts for the defensive parsing rules. This
  // makes a filtered /shop or /category/[slug] link reload-stable: the
  // grid you land on after a hard refresh is exactly the one you shared.
  const [filters, setFiltersState] = useState<ShopFilters>(() =>
    parseShopFiltersFromSearchParams(searchParams, { category: initialCategory }),
  );
  const [query, setQueryState] = useState<string>(
    () => parseShopSearchQuery(searchParams) || initialQuery || "",
  );
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // F-021: how many cards "Load more" had revealed when this page was
  // entered (`?show=`) — read once, on mount, because ProductGrid owns the
  // live count from there on. This is what makes Back from a product page
  // (which remounts this component) land on the same expanded list.
  const [initialVisibleCount] = useState(() => parseShopVisibleCount(searchParams));

  // Re-derives filters/query on browser back/forward, which change the
  // URL directly (via popstate) without going through this component's
  // own applyFilters/setState calls at all. The setState calls live
  // inside the popstate *callback*, not the effect body itself — the
  // effect only subscribes — which is the sanctioned "subscribe to an
  // external system" pattern (an earlier version of this fix called
  // setState directly in the effect body and tripped
  // react-hooks/set-state-in-effect: "Effects are intended to
  // synchronize... Subscribe for updates from some external system,
  // calling setState in a callback function when external state
  // changes"). Reads `window.location.search` directly rather than the
  // closed-over `searchParams` value so it doesn't depend on the
  // relative timing of Next's own popstate handling vs. this listener.
  useEffect(() => {
    const handlePopState = () => {
      const urlParams = new URLSearchParams(window.location.search);
      setFiltersState(parseShopFiltersFromSearchParams(urlParams, { category: initialCategory }));
      setQueryState(parseShopSearchQuery(urlParams) || initialQuery || "");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [initialCategory, initialQuery]);

  /**
   * Single choke point for every filter/query change: updates React state
   * immediately (so the grid reacts on the same click, not on a later
   * effect tick) and writes ONE combined URL — never two calls racing on
   * a stale URL snapshot, which is what a naive "clear all" (category +
   * query as two separate writes) would otherwise hit.
   *
   * This shallow-routes via the native History API instead of
   * next/navigation's router.push/replace. /shop and /category/[slug]'s
   * Server Components already read the `searchParams` prop for the
   * pre-existing category/q/sort params, which — per
   * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md
   * ("searchParams is a Request-time API ... Using it will opt the page
   * into dynamic rendering") — already makes both routes fully dynamic,
   * *before* this fix. A real router.push/replace would therefore
   * round-trip to the server on every single swatch/checkbox click.
   * history.pushState/replaceState update the address bar and history
   * stack — and, per Next's own "Shallow routing on the client" guide
   * (node_modules/next/dist/docs/01-app/02-guides/single-page-applications.md),
   * stay in sync with usePathname/useSearchParams — without that
   * round-trip, so filtering stays exactly as instant as it was before
   * this fix, just URL-synced (shareable/reload-stable/back-forward-able)
   * now too.
   *
   * push vs replace: a facet toggle (category, colour swatch, size,
   * fabric, on-sale, in-stock, sort) is one deliberate click, so it
   * `pushState`s — the back/forward buttons then step through each
   * choice one at a time, as F5's "back button doesn't undo a filter"
   * complaint asked for. The price slider's `onChange` and the search
   * box's `onChange` fire continuously (every drag tick / keystroke);
   * pushing on each of those would flood history with dozens of entries
   * for a single drag or a single typed word, so both are marked
   * `transient` and always `replaceState`.
   */
  const applyFilters = (
    nextFilters: ShopFilters,
    nextQuery: string,
    options?: { transient?: boolean },
  ) => {
    setFiltersState(nextFilters);
    setQueryState(nextQuery);
    if (!syncUrl) return;
    // Reads the merge base from `window.location.search` (always
    // synchronously current) rather than the `searchParams` hook value,
    // so two rapid clicks can't race on a stale snapshot while React
    // hasn't yet re-rendered with the previous click's URL. Safe here —
    // applyFilters only ever runs from a browser event handler.
    const params = applyShopFiltersToSearchParams(window.location.search, nextFilters, nextQuery);
    const qs = params.toString();
    const href = qs ? `${pathname}?${qs}` : pathname;
    if (options?.transient) {
      window.history.replaceState(null, "", href);
    } else {
      window.history.pushState(null, "", href);
    }
  };

  /** Keeps `?show=` in step with ProductGrid's "Load more" — always a
   * `replaceState` (revealing more cards isn't a history step of its own). */
  const handleVisibleCountChange = (count: number) => {
    if (!syncUrl) return;
    const qs = withShopVisibleCount(window.location.search, count).toString();
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };

  const setFilters = (next: ShopFilters, meta?: { transient?: boolean }) =>
    applyFilters(next, query, meta);

  const setQuery = (next: string) => applyFilters(filters, next, { transient: true });

  const categoryIsActiveFacet = isCategoryActiveFacet(filters, initialCategory);

  /** Empty-state escape hatch (storefront-ux F5): clears every facet and
   * the search query in one shot, so "no products match these filters"
   * always has a working one-click way out. Resets to `initialCategory`
   * (not `undefined`) so this never leaves a /category/[slug] page. */
  const clearAllFilters = () => applyFilters({ ...defaultShopFilters, category: initialCategory }, "");

  const hasActiveFilters =
    categoryIsActiveFacet ||
    filters.colors.length > 0 ||
    filters.sizes.length > 0 ||
    filters.fabrics.length > 0 ||
    filters.priceMax !== defaultShopFilters.priceMax ||
    Boolean(filters.onSale) ||
    Boolean(filters.inStock) ||
    query.trim().length > 0;

  const categoryDescendants = useMemo(() => buildCategoryDescendants(categories), [categories]);

  const filterCategories = useMemo<ShopFilterCategory[]>(
    () => categories.filter((c) => c.showInMenu).map((c) => ({ slug: c.slug, name: c.name })),
    [categories],
  );

  const categoryCounts = useMemo(() => {
    const leafCounts = countByCategory(products);
    const counts: Record<string, number> = {};
    for (const [slug, descendants] of Object.entries(categoryDescendants)) {
      counts[slug] = descendants.reduce((sum, s) => sum + (leafCounts[s] ?? 0), 0);
    }
    return counts;
  }, [products, categoryDescendants]);

  // release-hardening audit F-092: most `fabricFilters` options have no
  // matching product yet (fabricTech is only just starting to be populated
  // from admin-editable tags/fabric text — see mapDbProductToUi), so ticking
  // one of those always showed "0 Products". Hiding options no loaded
  // product actually has keeps the facet honest without needing a
  // per-product admin field before it can ship.
  const availableFabricIds = useMemo(
    () => new Set(products.flatMap((p) => p.fabricTech)),
    [products],
  );

  const filteredProducts = useMemo(() => {
    const result = filterProducts(products, filters, categoryDescendants);
    if (!query.trim()) return result;
    // release-hardening audit F-082: shares matchProducts with the header's
    // search dialog (tokenized, stemmed, prefix-matched) instead of the old
    // whole-string `contains` test, which returned nothing for "scrub
    // tops"/"lab coats" and the like. Used as a filter over `result`, not a
    // re-ranker — this only narrows the set, so the shopper's chosen sort
    // (price, rating, newest...) still applies to what's left.
    const matchedIds = new Set(matchProducts(result, query).map((product) => product.id));
    return result.filter((product) => matchedIds.has(product.id));
  }, [filters, products, query, categoryDescendants]);

  // F-100: one removable chip per active facet, shown on both the desktop
  // and mobile grids so closing the filter drawer never leaves a shopper
  // guessing what's still applied. Each `onRemove` goes through the same
  // `setFilters`/`setQuery` choke point as every other facet change, so
  // history stays a normal `pushState`, not a special transient write.
  // Rebuilt every render on purpose (a handful of small objects): the
  // callbacks close over this render's `filters`/`query`, so memoising
  // them would only add a stale-closure risk.
  const activeFilterChips = buildActiveFilterChips({
    filters,
    query,
    initialCategory,
    categoryName: (slug) => filterCategories.find((c) => c.slug === slug)?.name ?? slug,
    fabricLabel: (id) => fabricFilters.find((f) => f.id === id)?.label ?? id,
    formatPrice,
    setFilters,
    setQuery,
  });

  const pageTitle = heading?.title ?? "Shop All Apparel & Uniforms";
  const pageEyebrow = heading?.eyebrow ?? "Browse";
  const pageDescription =
    heading?.description ??
    "Explore medical scrubs, hospital apparel, institutional linens, school uniforms and kidswear by category and size.";
  const breadcrumbLabel = heading?.breadcrumbLabel ?? "Shop";

  return (
    <>
      {/* F-242: `py-6` (was `py-10`) on mobile — this band, the tall hero
          and a 1-column grid together pushed the first product off-screen
          by hundreds of px. */}
      <section className="relative overflow-hidden border-b border-border bg-alt-surface py-6 md:py-14">
        {headingImage ? (
          <>
            <Image
              src={headingImage.url}
              alt={headingImage.alt}
              fill
              preload
              className="object-cover"
              sizes="100vw"
            />
            <div className="absolute inset-0 bg-white/78" aria-hidden />
          </>
        ) : null}
        <div className="relative mx-auto max-w-[1320px] px-4 lg:px-8">
          <nav className="mb-3 text-sm text-muted md:mb-6">
            <Link href="/" className="hover:text-brand">
              Home
            </Link>
            <span className="mx-2">›</span>
            <span className="font-semibold text-ink">{breadcrumbLabel}</span>
          </nav>
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{pageEyebrow}</p>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink md:text-5xl">
              {pageTitle}
            </h1>
            {/* F-242: hidden on mobile — this description was pushing the
                search/sort toolbar, and every product below it, further
                down a page that was already ~45,000px tall. */}
            <p className="mt-3 hidden text-base leading-relaxed text-muted sm:block">{pageDescription}</p>
          </div>
        </div>
      </section>

      <section className="pt-4 pb-12 md:py-14">
        {/* F-011: an explicit `grid-cols-1` (`minmax(0,1fr)`) rather than the
            implicit `auto` track this used to have below `lg`, so the grid
            column can shrink below the toolbar's min-content instead of
            growing to it — that's what pushed /shop and /category 7px past
            a 360px viewport. */}
        <div className="mx-auto grid max-w-[1320px] grid-cols-1 gap-10 px-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:px-8">
          <div className="hidden lg:block">
            <ShopFiltersPanel
              filters={filters}
              onChange={setFilters}
              categories={filterCategories}
              categoryCounts={categoryCounts}
              totalCount={products.length}
              availableFabricIds={availableFabricIds}
            />
          </div>
          <ProductGrid
            products={filteredProducts}
            totalCount={filteredProducts.length}
            sort={filters.sort}
            onSortChange={(sort) => setFilters({ ...filters, sort })}
            onOpenFilters={() => setMobileFiltersOpen(true)}
            searchQuery={query}
            onSearchQueryChange={setQuery}
            onClearFilters={hasActiveFilters ? clearAllFilters : undefined}
            activeFilters={activeFilterChips}
            initialVisibleCount={initialVisibleCount}
            onVisibleCountChange={handleVisibleCountChange}
          />
        </div>
      </section>

      <MobileFilterDrawer
        open={mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
        filters={filters}
        onChange={setFilters}
        categories={filterCategories}
        categoryCounts={categoryCounts}
        totalCount={products.length}
        availableFabricIds={availableFabricIds}
        resultCount={filteredProducts.length}
        activeCount={activeFilterChips.length}
        onClearAll={clearAllFilters}
      />

      {showExtras && (
        <>
          <ShopMixMatchPromo mixMatchEnabled={mixMatchEnabled} />
          <TrustBar returnWindowDays={returnWindowDays} />
          <TestimonialsSection testimonials={testimonials} />
          <ShopFeatureCards fabricTechEnabled={fabricTechEnabled} />
        </>
      )}
    </>
  );
}
