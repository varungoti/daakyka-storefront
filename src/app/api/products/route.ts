import { getProducts } from "@/lib/products";
import { toPublicSearchProduct } from "@/lib/products/public-search-product";
import { NextResponse } from "next/server";

// F-031: unauthenticated — see toPublicSearchProduct for what is stripped and why.
export async function GET() {
  const products = await getProducts();
  return NextResponse.json({ products: products.map(toPublicSearchProduct) });
}
