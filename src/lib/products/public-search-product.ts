import type { Product } from "@/lib/types";

/**
 * What the header's predictive search dialog needs to rank and render one
 * result — see matchProducts (src/lib/search/match-products.ts) for the
 * fields it ranks on, and src/components/search/search-dialog.tsx for what a
 * result row shows. A `colors` entry carries the name only: the dialog never
 * draws a swatch.
 *
 * `compareAtPrice` and `available` (a yes/no, never a stock count) are there
 * for the wishlist (F-113), which shows a live price and a sold-out tag from
 * this same index instead of a copy saved when the heart was tapped.
 */
export type SearchProduct = Pick<
  Product,
  | "id"
  | "handle"
  | "name"
  | "colorName"
  | "price"
  | "compareAtPrice"
  | "available"
  | "image"
  | "category"
  | "categorySlug"
  | "categoryName"
  | "section"
  | "tags"
  | "fabricTech"
> & { colors: { name: string }[] };

/**
 * F-031/F-013: what GET /api/products (unauthenticated) hands to anyone who
 * asks. It used to return the entire catalog verbatim — every product's full
 * HTML description, every image and every variant's `stock` (60+ products,
 * ~200 KB) — letting a competitor's scraper track sell-through across the
 * whole store and re-host the product content. F-031 stripped those; the
 * dialog downloads this index on first use, so it is now cut to just the
 * search/result fields (ratings, sizes, badges, timestamps and the rest of
 * the Product are not needed to find a product and link to it).
 *
 * Strip them here rather than changing what getProducts() returns everywhere
 * else (the PDP, shop listing and sitemap all still get the full object; the
 * PDP separately caps `stock`, see publicStockCeiling).
 *
 * Lives outside the route file because a Next route module may only export
 * its HTTP handlers.
 */
export function toPublicSearchProduct(product: Product): SearchProduct {
  return {
    id: product.id,
    handle: product.handle,
    name: product.name,
    colorName: product.colorName,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    available: product.available,
    image: product.image,
    category: product.category,
    categorySlug: product.categorySlug,
    categoryName: product.categoryName,
    section: product.section,
    tags: product.tags,
    fabricTech: product.fabricTech,
    colors: product.colors.map((color) => ({ name: color.name })),
  };
}
