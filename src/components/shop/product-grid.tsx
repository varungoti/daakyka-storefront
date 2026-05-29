"use client";

import { ProductCard } from "@/components/ui/product-card";
import type { Product } from "@/lib/types";
import type { SortOption } from "@/lib/shop/filters";
import { SlidersHorizontal } from "lucide-react";
import { useState } from "react";

interface ProductGridProps {
  products: Product[];
  totalCount: number;
  sort?: SortOption;
  onSortChange?: (sort: SortOption) => void;
  onOpenFilters?: () => void;
  showToolbar?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
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

  return (
    <div>
      {showToolbar && (
        <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-border bg-white px-5 py-4">
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
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              Sort by:
              <select
                value={sort}
                onChange={(event) =>
                  handleSortChange(event.target.value as SortOption)
                }
                className="rounded-full border border-border bg-white px-4 py-2 text-sm text-ink outline-none focus:border-brand"
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
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold lg:hidden"
              >
                <SlidersHorizontal size={16} />
                Filter
              </button>
            )}
          </div>
          </div>
        </div>
      )}

      {products.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border bg-lavender/20 px-6 py-16 text-center">
          <p className="font-display text-xl font-bold text-ink">No products found</p>
          <p className="mt-2 text-sm text-muted">
            Try adjusting your filters to see more results.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}
