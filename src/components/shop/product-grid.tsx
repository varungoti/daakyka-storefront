"use client";

import { ProductCard } from "@/components/ui/product-card";
import type { Product } from "@/lib/types";
import { SHOP_PAGE_SIZE, type SortOption } from "@/lib/shop/filters";
import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

/** F-100: one removable active-facet pill (category/color/size/fabric/
 * price/on-sale/in-stock/search-query) built by ShopPageContent, which
 * owns the filter state each `onRemove` needs to update. */
export interface ActiveFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface ProductGridProps {
  products: Product[];
  totalCount: number;
  sort?: SortOption;
  onSortChange?: (sort: SortOption) => void;
  onOpenFilters?: () => void;
  showToolbar?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  /** storefront-ux F5: when provided (i.e. at least one facet or the
   * search query is active), a zero-result grid shows a "Clear all
   * filters" button that calls this instead of a dead end. Omitted on
   * grids with no filter UI at all (e.g. /sale, section landing pages). */
  onClearFilters?: () => void;
  /** F-100: removable chips for the active facets, rendered under the
   * count/sort row, plus a "Clear all" text button once there are 2 or
   * more. Also drives the mobile Filter button's active-count badge.
   * Omitted on grids with no filter UI at all (e.g. /sale). */
  activeFilters?: ActiveFilterChip[];
  /** F-021: how many cards to render before the first "Load more" — the
   * caller passes what it read back from the URL (`?show=`) so that coming
   * back from a product page restores the list the shopper had expanded
   * instead of collapsing it to one page. Defaults to one page. */
  initialVisibleCount?: number;
  /** Called with the new total each time "Load more" reveals another page,
   * so the caller can keep it in the URL (see `initialVisibleCount`). */
  onVisibleCountChange?: (count: number) => void;
  /** F-261: preload the first card's image and mark it high priority. Only
   * for a listing whose first card really is the page's LCP image — /shop and
   * /category/[slug], where the grid is the first thing under a short heading
   * band. Everywhere else the grid sits below a hero or other sections (the
   * home page's Featured grid is several screens down), and a high-priority
   * image there competes with the real LCP image for early bandwidth.
   * Defaults to false. */
  eagerFirst?: boolean;
}

export function ProductGrid({
  products,
  totalCount,
  sort: controlledSort,
  onSortChange,
  onOpenFilters,
  showToolbar = true,
  searchQuery,
  onSearchQueryChange,
  onClearFilters,
  activeFilters,
  initialVisibleCount,
  onVisibleCountChange,
  eagerFirst = false,
}: ProductGridProps) {
  const [internalSort, setInternalSort] = useState<SortOption>("featured");
  const sort = controlledSort ?? internalSort;

  const handleSortChange = (value: SortOption) => {
    if (onSortChange) {
      onSortChange(value);
    } else {
      setInternalSort(value);
    }
  };

  // F-021: /shop rendered every matching product at once (about 45,000px
  // of DOM for its ~57 products) with no way to see less of it. `products`
  // gets a new array identity every time ShopPageContent re-filters/sorts
  // (see filterProducts/useMemo there), so comparing it to the previous
  // render's identity — the React-docs-recommended "adjust state during
  // rendering" pattern, not a `useEffect` — resets the page size back to
  // the first SHOP_PAGE_SIZE items whenever the underlying list actually
  // changes, without a wasted extra render or a `react-hooks/*` lint
  // exemption. (The URL's `?show=` goes with it: applyFilters in
  // ShopPageContent drops it on every facet/sort/search change.)
  const [visibleCount, setVisibleCount] = useState(initialVisibleCount ?? SHOP_PAGE_SIZE);
  const [lastProducts, setLastProducts] = useState(products);
  if (products !== lastProducts) {
    setLastProducts(products);
    setVisibleCount(SHOP_PAGE_SIZE);
  }
  const visibleProducts = products.slice(0, visibleCount);
  const hasMore = visibleCount < products.length;

  const loadMore = () => {
    const next = visibleCount + SHOP_PAGE_SIZE;
    setVisibleCount(next);
    onVisibleCountChange?.(next);
  };

  return (
    <div>
      {/* Product cards title themselves with an h3, but on /shop and the
          category listings the only heading above the grid is the page's h1
          — axe's heading-order (a skipped level) fired on every card. */}
      {showToolbar && <h2 className="sr-only">Products</h2>}
      {showToolbar && (
        <div className="hover:border-brand hover:shadow-sm transition-colors mb-4 flex flex-col gap-3 rounded-2xl border border-border bg-surface-elevated px-4 py-3 sm:mb-6 sm:gap-4 sm:px-5 sm:py-4">
          {onSearchQueryChange && (
            <input
              type="search"
              value={searchQuery ?? ""}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              aria-label="Search within results"
              placeholder="Search within results..."
              className="w-full rounded-full border border-border px-4 py-2.5 text-sm outline-none focus:border-brand"
            />
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          {/* role="status": the count changes when a filter is applied, which
              is otherwise silent to a screen reader. */}
          <p role="status" className="text-sm text-muted">
            <span className="font-semibold text-ink">
              {totalCount} {totalCount === 1 ? "Product" : "Products"}
            </span>
          </p>
          {/* F-011/F-242: on a phone, Filter and Sort share one row (each
              half the card's width, "Sort by:" shown to screen readers only)
              instead of three stacked rows; from `sm` up it's the same
              inline label + select + button as before. `min-w-0` on the
              shrinkable children is what keeps this row from running past a
              360px viewport — its min-content (label + select + Filter
              button) used to be wider than the card itself. */}
          <div className="flex items-center gap-2 sm:gap-3">
            {onOpenFilters && (
              <button
                type="button"
                onClick={onOpenFilters}
                aria-label={
                  activeFilters && activeFilters.length > 0
                    ? `Filter, ${activeFilters.length} active`
                    : "Filter"
                }
                className="relative inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full border border-border px-3 py-2 text-sm font-semibold sm:flex-none sm:px-4 lg:hidden"
              >
                <SlidersHorizontal size={16} />
                Filter
                {/* F-100: makes the drawer's active facets visible without
                    opening it. */}
                {activeFilters && activeFilters.length > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                    {activeFilters.length}
                  </span>
                )}
              </button>
            )}
            <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted sm:flex-none">
              {/* `max-sm:sr-only` rather than `sr-only sm:not-sr-only`:
                  globals.css has its own unlayered `.sr-only` that a
                  layered `not-sr-only` can't undo. */}
              <span className="max-sm:sr-only">Sort by:</span>
              <select
                value={sort}
                onChange={(event) =>
                  handleSortChange(event.target.value as SortOption)
                }
                className="min-w-0 max-w-full flex-1 rounded-full border border-border bg-surface-elevated px-3 py-2 text-sm text-ink outline-none focus:border-brand sm:flex-none sm:px-4"
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="newest">Newest</option>
                <option value="rating">Best Rating</option>
              </select>
            </label>
          </div>
          </div>

          {/* F-100: removable chips for every active facet, so closing the
              drawer doesn't leave a shopper guessing what's still applied —
              omitted entirely when the caller has no filter UI at all
              (e.g. /sale) since `activeFilters` is then never passed. */}
          {activeFilters && activeFilters.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {activeFilters.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onRemove}
                  aria-label={`Remove filter: ${chip.label}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink transition hover:border-brand hover:text-brand"
                >
                  {chip.label}
                  <X size={12} aria-hidden="true" />
                </button>
              ))}
              {activeFilters.length > 1 && onClearFilters && (
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="px-2 py-1.5 text-xs font-semibold text-muted underline-offset-2 hover:text-brand hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {products.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-surface-muted px-6 py-16 text-center">
          <p className="font-display text-xl font-bold text-ink">
            {onClearFilters ? "No products match these filters" : "No products found"}
          </p>
          <p className="mt-2 text-sm text-muted">
            {onClearFilters
              ? "Try removing a filter, or start over to see the full catalog."
              : "Try adjusting your filters to see more results."}
          </p>
          {onClearFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="mt-5 inline-flex items-center justify-center rounded-full border border-border bg-surface-elevated px-5 py-2.5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-6 xl:grid-cols-4">
            {visibleProducts.map((product, index) => (
              // Only the very first card, and only when the caller says it is
              // the LCP candidate (`eagerFirst`): that was the only card above
              // the fold at all (a single mobile column), and stays true of
              // the mobile Lighthouse profile this app is gated on
              // (lighthouserc.js, 412px wide): index 0 is still the LCP
              // candidate there even now that F-021/F-242 made this a
              // 2-column grid on phones (index 1 sits beside it, not below
              // it). Measured trying index < 4 (one full xl: row): it
              // regressed median LCP on /shop (~4.5s -> ~4.8s) instead of
              // improving it, because next/image's `preload` inserts a
              // `<link rel=preload>` per image — 3 of those 4 were for
              // below-the-fold-on-mobile cards, competing for bandwidth
              // against the one that's actually the LCP candidate. Matches
              // the Image doc's own guidance against `preload` "when you
              // have multiple images that could be considered the LCP
              // element depending on viewport" — see ProductCard's
              // loadEagerly doc and docs/PERFORMANCE.md. Not re-measured
              // for index 1 as part of this fix (needs the same Lighthouse
              // profiling, not a guess) — left as-is deliberately.
              //
              // F-260: `prefetchOnIntent` — a listing is dozens of links; see
              // ProductCard's doc comment for why they are not all prefetched
              // as they scroll into view.
              <ProductCard
                key={product.id}
                product={product}
                loadEagerly={eagerFirst && index === 0}
                prefetchOnIntent
                compact
              />
            ))}
          </div>

          {hasMore && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <p className="text-sm text-muted">
                Showing {visibleProducts.length} of {products.length}
              </p>
              <button
                type="button"
                onClick={loadMore}
                className="inline-flex items-center justify-center rounded-full border border-border bg-surface-elevated px-6 py-2.5 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand"
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
