import { PRICE_FILTER_MAX_INR } from "@/lib/currency/config";

import type { FabricTech, Product } from "@/lib/types";

export type SortOption =
  | "featured"
  | "price-asc"
  | "price-desc"
  | "newest"
  | "rating";

export interface ShopFilters {
  category?: string;
  colors: string[];
  sizes: string[];
  fabrics: string[];
  priceMax: number;
  sort: SortOption;
}

// The default must be the top of the filter's own range, not some lower
// "typical" cutoff — a lower default silently hides any real product
// priced above it until the shopper manually drags the slider (v1 5.5).
export const defaultShopFilters: ShopFilters = {
  colors: [],
  sizes: [],
  fabrics: [],
  priceMax: PRICE_FILTER_MAX_INR,
  sort: "featured",
};

export function filterProducts(
  products: Product[],
  filters: ShopFilters,
  /** Maps a category slug to itself plus every descendant slug, so
   * selecting a parent category (e.g. "for-hospitals") also matches
   * products filed under its sub-categories. Omit for an exact-slug
   * match only (the pre-Phase-B3 behaviour, and what the unit tests
   * below exercise). */
  categoryDescendants?: Record<string, string[]>,
): Product[] {
  let result = [...products];

  if (filters.category) {
    const allowed = categoryDescendants?.[filters.category] ?? [filters.category];
    result = result.filter((product) => allowed.includes(product.category));
  }

  if (filters.colors.length > 0) {
    result = result.filter((product) =>
      product.colors.some((color) => filters.colors.includes(color.name)),
    );
  }

  if (filters.sizes.length > 0) {
    result = result.filter((product) =>
      product.sizes.some((size) => filters.sizes.includes(size)),
    );
  }

  if (filters.fabrics.length > 0) {
    result = result.filter((product) =>
      filters.fabrics.some((fabric) =>
        product.fabricTech.includes(fabric as FabricTech),
      ),
    );
  }

  result = result.filter((product) => product.price <= filters.priceMax);

  switch (filters.sort) {
    case "price-asc":
      result.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      result.sort((a, b) => b.price - a.price);
      break;
    case "rating":
      result.sort((a, b) => b.rating - a.rating);
      break;
    case "newest":
      result.sort((a, b) => {
        const aNew = a.badge === "new" ? 1 : 0;
        const bNew = b.badge === "new" ? 1 : 0;
        return bNew - aNew;
      });
      break;
    default:
      result.sort((a, b) => {
        const aScore = (a.badge === "best-seller" ? 2 : 0) + a.rating;
        const bScore = (b.badge === "best-seller" ? 2 : 0) + b.rating;
        return bScore - aScore;
      });
  }

  return result;
}

export function countByCategory(products: Product[]) {
  return products.reduce<Record<string, number>>((acc, product) => {
    acc[product.category] = (acc[product.category] ?? 0) + 1;
    return acc;
  }, {});
}
