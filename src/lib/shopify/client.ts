import { getShopifyConfig } from "@/lib/shopify/config";

interface ShopifyFetchOptions {
  query: string;
  variables?: Record<string, unknown>;
  cache?: RequestCache;
  tags?: string[];
}

export async function shopifyFetch<T>({
  query,
  variables,
  cache = "force-cache",
  tags,
}: ShopifyFetchOptions): Promise<T> {
  const config = getShopifyConfig();

  if (!config) {
    throw new Error("Shopify is not configured");
  }

  const response = await fetch(
    `https://${config.domain}/api/${config.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": config.token,
      },
      body: JSON.stringify({ query, variables }),
      cache,
      next: tags ? { tags } : undefined,
    },
  );

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.statusText}`);
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(json.errors[0]?.message ?? "Shopify GraphQL error");
  }

  return json.data as T;
}
