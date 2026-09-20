"use client";

import { MobileFilterDrawer } from "@/components/shop/mobile-filter-drawer";
import { ProductGrid } from "@/components/shop/product-grid";
import { ShopFiltersPanel, type ShopFilterCategory } from "@/components/shop/shop-filters-panel";
import {
  ShopFeatureCards,
  ShopMixMatchPromo,
} from "@/components/shop/shop-feature-cards";
import { TrustBar } from "@/components/layout/trust-bar";
import {
  applyShopFiltersToSearchParams,
  countByCategory,
  defaultShopFilters,
  filterProducts,
  parseShopFiltersFromSearchParams,
  parseShopSearchQuery,
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
  /** Overrides the "Shop All Scrubs" hero copy — used by /category/[slug]
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
}: ShopPageContentProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

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

  const setFilters = (next: ShopFilters, meta?: { transient?: boolean }) =>
    applyFilters(next, query, meta);

  const setQuery = (next: string) => applyFilters(filters, next, { transient: true });

  /** Empty-state escape hatch (storefront-ux F5): clears every facet and
   * the search query in one shot, so "no products match these filters"
   * always has a working one-click way out. */
  const clearAllFilters = () => applyFilters({ ...defaultShopFilters, category: undefined }, "");

  const hasActiveFilters =
    Boolean(filters.category) ||
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

  const filteredProducts = useMemo(() => {
    const result = filterProducts(products, filters, categoryDescendants);
    const q = query.trim().toLowerCase();
    if (!q) return result;
    return result.filter(
      (product) =>
        product.name.toLowerCase().includes(q) ||
        product.colorName.toLowerCase().includes(q) ||
        product.category.toLowerCase().includes(q),
    );
  }, [filters, products, query, categoryDescendants]);

  const pageTitle = heading?.title ?? "Shop All Scrubs";
  const pageEyebrow = heading?.eyebrow ?? "Browse";
  const pageDescription =
    heading?.description ??
    "Premium medical apparel with advanced filters for color, size, fabric technology, and price — built for long shifts and demanding care environments.";
  const breadcrumbLabel = heading?.breadcrumbLabel ?? "Shop";

  return (
    <>
      <section className="relative overflow-hidden border-b border-border bg-alt-surface py-10 md:py-14">
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
          <nav className="mb-6 text-sm text-muted">
            <Link href="/" className="hover:text-brand">
              Home
            </Link>
            <span className="mx-2">›</span>
            <span className="font-semibold text-ink">{breadcrumbLabel}</span>
          </nav>
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand">{pageEyebrow}</p>
            <h1 className="mt-2 font-display text-4xl font-bold tracking-tight text-ink md:text-5xl">
              {pageTitle}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-muted">{pageDescription}</p>
          </div>
        </div>
      </section>

      <section className="py-12 md:py-14">
        <div className="mx-auto grid max-w-[1320px] gap-10 px-4 lg:grid-cols-[280px_1fr] lg:px-8">
          <div className="hidden lg:block">
            <ShopFiltersPanel
              filters={filters}
              onChange={setFilters}
              categories={filterCategories}
              categoryCounts={categoryCounts}
              totalCount={products.length}
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
      />

      {showExtras && (
        <>
          <ShopMixMatchPromo mixMatchEnabled={mixMatchEnabled} />
          <TrustBar />
          <TestimonialsSection testimonials={testimonials} />
          <ShopFeatureCards fabricTechEnabled={fabricTechEnabled} />
        </>
      )}
    </>
  );
}
