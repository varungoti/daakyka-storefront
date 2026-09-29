import { getProducts } from "@/lib/products";
import type { Product } from "@/lib/types";
import { NextResponse } from "next/server";

// F-031 fix: this route is unauthenticated and used to return the entire
// catalog verbatim — every product's full HTML description, every image,
// and every variant's exact on-hand `stock` (60+ products, ~200 KB),
// letting anyone (a competitor's scraper, in particular) track exact
// sell-through across the whole store and re-host full product content.
// The only consumer is the header's predictive search dialog
// (src/components/search/search-dialog.tsx), via matchProducts
// (src/lib/search/match-products.ts), which ranks and renders a result
// using name/colorName/category(Slug|Name)/section/tags/colors/
// fabricTech/image/price/handle — never variants, stock, or description
// HTML. Strip those out here rather than changing what getProducts()
// returns everywhere else (PDP, shop listing, sitemap, etc. all still get
// the full object).
function toPublicSearchResult(product: Product): Product {
  return {
    ...product,
    description: undefined,
    descriptionHtml: undefined,
    images: undefined,
    variants: undefined,
  };
}

export async function GET() {
  const products = await getProducts();
  return NextResponse.json({ products: products.map(toPublicSearchResult) });
}
