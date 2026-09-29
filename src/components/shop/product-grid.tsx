"use client";

import { ProductCard } from "@/components/ui/product-card";
import type { Product } from "@/lib/types";
import type { SortOption } from "@/lib/shop/filters";
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

// F-021/F-242: how many cards render before a "Load more" step. 24 is 6
// rows at the desktop `xl:grid-cols-4` width and 12 rows at the mobile
// 2-column width — long enough that "Load more" isn't the very first
// thing a shopper sees, short enough that /shop's ~57 products don't ship
// ~45,000px of DOM up front.
const PAGE_SIZE = 24;

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
  // the first PAGE_SIZE items whenever the underlying list actually
  // changes, without a wasted extra render or a `react-hooks/*` lint
  // exemption. Plain pagination that changes with the URL is a separate
  // question this doesn't take on (see fix guidance's own "optional" note
  // in F-021/F-242's audit finding).
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [lastProducts, setLastProducts] = useState(products);
  if (products !== lastProducts) {
    setLastProducts(products);
    setVisibleCount(PAGE_SIZE);
  }
  const visibleProducts = products.slice(0, visibleCount);
  const hasMore = visibleCount < products.length;

  return (
    <div>
      {showToolbar && (
        <div className="hover:border-brand hover:shadow-sm transition-colors mb-6 flex flex-col gap-4 rounded-2xl border border-border bg-surface-elevated px-5 py-4">
          {onSearchQueryChange && (
            <input
              type="search"
              value={searchQuery ?? ""}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search within results..."
              className="w-full rounded-full border border-border px-4 py-2.5 text-sm outline-none focus:border-brand"
            />
          )}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            <span className="font-semibold text-ink">{totalCount} Products</span>
          </p>
          {/* F-011: `flex-wrap` plus `min-w-0` on the shrinkable children —
              this row's min-content (label + select + Filter button) was
              wider than a 360px card, and none of them could wrap or
              shrink, so the toolbar card ran past the viewport's right
              edge. */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-w-0 items-center gap-2 text-sm text-muted">
              Sort by:
              <select
                value={sort}
                onChange={(event) =>
                  handleSortChange(event.target.value as SortOption)
                }
                className="min-w-0 max-w-full rounded-full border border-border bg-surface-elevated px-4 py-2 text-sm text-ink outline-none focus:border-brand"
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="newest">Newest</option>
                <option value="rating">Best Rating</option>
              </select>
            </label>
            {onOpenFilters && (
              <button
                type="button"
                onClick={onOpenFilters}
                aria-label={
                  activeFilters && activeFilters.length > 0
                    ? `Filter, ${activeFilters.length} active`
                    : "Filter"
                }
                className="relative inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold lg:hidden"
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
                  className="text-xs font-semibold text-muted underline-offset-2 hover:text-brand hover:underline"
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
              // Only the very first card — this used to be the only card
              // above the fold at all (a single mobile column), and stays
              // true of the mobile Lighthouse profile this app is gated on
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
              <ProductCard key={product.id} product={product} loadEagerly={index === 0} />
            ))}
          </div>

          {hasMore && (
            <div className="mt-8 flex flex-col items-center gap-3">
              <p className="text-sm text-muted">
                Showing {visibleProducts.length} of {products.length}
              </p>
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
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
