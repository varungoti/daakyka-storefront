import { getProducts } from "@/lib/products";
import { toPublicSearchProduct } from "@/lib/products/public-search-product";
import { NextResponse } from "next/server";

// F-013: this is the header search dialog's product index, the same for every
// visitor. It used to be a per-request function run (no cache headers, ~0.6 s
// from India, a MISS every time); as a prerendered route it is served from
// the CDN. getProducts() is tagged "products", so an admin catalog save or a
// stock change (revalidateTag) refreshes it along with the listing pages, and
// the 300 s TTL matches the catalog caches it reads from
// (CATALOG_CACHE_REVALIDATE_SECONDS in src/lib/products/index.ts) as the bound
// for a change made any other way.
export const dynamic = "force-static";
export const revalidate = 300;

// F-031: unauthenticated — see toPublicSearchProduct for what is stripped and why.
export async function GET() {
  const products = await getProducts();
  return NextResponse.json({ products: products.map(toPublicSearchProduct) });
}
