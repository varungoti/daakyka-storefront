import { products as seedProducts, bestSellers as seedBestSellers } from "@/data/products";
import { isShopifyConfigured } from "@/lib/shopify/config";
import { shopifyFetch } from "@/lib/shopify/client";
import {
  mapShopifyProduct,
  type ShopifyProduct,
} from "@/lib/shopify/mappers";
import {
  GET_PRODUCT_BY_HANDLE_QUERY,
  GET_PRODUCTS_QUERY,
} from "@/lib/shopify/queries";
import type { Product, ProductCategory } from "@/lib/types";

interface ProductsResponse {
  products: {
    edges: { node: ShopifyProduct }[];
  };
}

interface ProductResponse {
  product: ShopifyProduct | null;
}

export async function getProducts(): Promise<Product[]> {
  if (!isShopifyConfigured()) {
    return seedProducts;
  }

  try {
    const data = await shopifyFetch<ProductsResponse>({
      query: GET_PRODUCTS_QUERY,
      variables: { first: 50 },
      tags: ["products"],
    });

    const mapped = data.products.edges.map(({ node }) => mapShopifyProduct(node));
    return mapped.length > 0 ? mapped : seedProducts;
  } catch {
    return seedProducts;
  }
}

export async function getProductByHandle(handle: string): Promise<Product | null> {
  if (!isShopifyConfigured()) {
    return seedProducts.find((p) => p.handle === handle) ?? null;
  }

  try {
    const data = await shopifyFetch<ProductResponse>({
      query: GET_PRODUCT_BY_HANDLE_QUERY,
      variables: { handle },
      tags: [`product-${handle}`],
    });

    if (!data.product) {
      return seedProducts.find((p) => p.handle === handle) ?? null;
    }

    return mapShopifyProduct(data.product);
  } catch {
    return seedProducts.find((p) => p.handle === handle) ?? null;
  }
}

export async function getBestSellers(): Promise<Product[]> {
  const all = await getProducts();
  const featured = all.filter((p) => p.badge === "best-seller" || p.rating >= 4.8);
  return featured.length > 0 ? featured.slice(0, 4) : seedBestSellers;
}

export async function getProductsByCategory(
  category?: ProductCategory,
): Promise<Product[]> {
  const all = await getProducts();
  if (!category) return all;
  return all.filter((p) => p.category === category);
}

export function getProductSource(): "shopify" | "seed" {
  return isShopifyConfigured() ? "shopify" : "seed";
}
