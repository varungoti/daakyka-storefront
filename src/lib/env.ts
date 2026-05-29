function isShopifyConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN &&
      process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN,
  );
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/** True on any Vercel deployment (preview or production). */
export function isVercel(): boolean {
  return Boolean(process.env.VERCEL);
}

/** True when deployed to Vercel production (strict env enforcement). */
export function isVercelProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/** Staging/preview should not be indexed by search engines. */
export function isIndexingAllowed(): boolean {
  if (process.env.NEXT_PUBLIC_ALLOW_INDEXING === "false") return false;
  if (process.env.VERCEL_ENV === "preview") return false;
  return true;
}

/**
 * Validates required environment variables at startup/build.
 * Strict failures only on Vercel production; CI/local builds warn instead.
 */
export function validateEnv(): void {
  const authSecret = process.env.AUTH_SECRET;
  const enforceStrict =
    isVercelProduction() || process.env.ENFORCE_PRODUCTION_ENV === "1";

  const databaseUrl = process.env.DATABASE_URL ?? "";

  if (isVercel() && databaseUrl.startsWith("file:")) {
    throw new Error(
      "DATABASE_URL must be a Postgres URL on Vercel (SQLite file: is dev-only)",
    );
  }

  if (enforceStrict) {
    if (!authSecret || authSecret.length < 32) {
      throw new Error(
        "AUTH_SECRET must be set to at least 32 characters in production",
      );
    }

    if (databaseUrl.startsWith("file:")) {
      throw new Error(
        "DATABASE_URL must be a Postgres URL in production (SQLite is dev-only)",
      );
    }

    if (!process.env.CRON_SECRET) {
      throw new Error("CRON_SECRET must be set in production");
    }

    if (isShopifyConfigured() && !process.env.SHOPIFY_WEBHOOK_SECRET) {
      throw new Error(
        "SHOPIFY_WEBHOOK_SECRET must be set when Shopify Storefront is configured",
      );
    }
    return;
  }

  if (authSecret && authSecret.length < 32) {
    console.warn(
      "[env] AUTH_SECRET is shorter than 32 characters — use a longer secret in production",
    );
  }
}
