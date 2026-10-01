import type { Product } from "@/lib/types";

/**
 * F-031: what GET /api/products (unauthenticated) hands to anyone who asks.
 * It used to return the entire catalog verbatim — every product's full HTML
 * description, every image, and every variant's `stock` (60+ products,
 * ~200 KB) — letting a competitor's scraper track sell-through across the
 * whole store and re-host the product content.
 *
 * The only consumer is the header's predictive search dialog
 * (src/components/search/search-dialog.tsx) via matchProducts
 * (src/lib/search/match-products.ts), which ranks and renders a result from
 * name/colorName/category(Slug|Name)/section/tags/colors/fabricTech/image/
 * price/handle — never variants, stock, or description HTML. Strip those here
 * rather than changing what getProducts() returns everywhere else (the PDP,
 * shop listing and sitemap all still get the full object; the PDP separately
 * caps `stock`, see publicStockCeiling).
 *
 * Lives outside the route file because a Next route module may only export
 * its HTTP handlers.
 */
export function toPublicSearchProduct(product: Product): Product {
  return {
    ...product,
    description: undefined,
    descriptionHtml: undefined,
    images: undefined,
    variants: undefined,
  };
}
