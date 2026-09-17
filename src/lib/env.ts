// Relative import, not the "@/" alias: next.config.ts imports validateEnv
// from this file through its own transpile-config pipeline, which doesn't
// resolve tsconfig path aliases the way the main Next.js app build does.
import { isInsecureSeedPassword } from "./auth/seed-defaults";

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

    const adminSeedPassword = process.env.ADMIN_SEED_PASSWORD;
    if (!adminSeedPassword || isInsecureSeedPassword(adminSeedPassword)) {
      throw new Error(
        "ADMIN_SEED_PASSWORD must be set to a unique password of at least 12 characters " +
          "in production (not a known default) — prisma/seed.ts also enforces this at build time.",
      );
    }

    if (!process.env.NEXT_PUBLIC_SITE_URL?.startsWith("https://")) {
      throw new Error(
        "NEXT_PUBLIC_SITE_URL must be set to your production https:// URL — it also controls " +
          "whether the admin session cookie is marked Secure.",
      );
    }

    if (process.env.BREVO_API_KEY && !process.env.BREVO_FROM_EMAIL) {
      throw new Error("BREVO_FROM_EMAIL must be set when BREVO_API_KEY is configured");
    }

    // AI image generation and R2 storage are optional integrations: warn
    // rather than fail the build/boot when their credentials aren't set
    // yet (e.g. before the client has rotated/provided them) — every
    // caller already checks isImageGenerationConfigured()/isR2Configured()
    // and reports a clear "not configured" error instead of crashing.
    if (!process.env.OPENAI_API_KEY) {
      console.warn(
        "[env] OPENAI_API_KEY is not set — AI image generation will report as not configured",
      );
    }

    const missingR2Vars = [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_BUCKET",
      "R2_PUBLIC_BASE_URL",
    ].filter((key) => !process.env[key]);
    if (missingR2Vars.length > 0) {
      console.warn(
        `[env] Cloudflare R2 storage is not fully configured (missing: ${missingR2Vars.join(", ")}) — media upload and AI image storage will report as not configured`,
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
