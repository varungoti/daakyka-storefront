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
 * F-054 fix: NEXT_PUBLIC_ALLOW_INDEXING is a legitimate staging-only kill
 * switch (see isIndexingAllowed above) — it must keep working when an
 * owner deliberately soft-launches a noindexed production deployment, so
 * validateEnv() below never throws on it. What actually shipped this
 * finding was that same var being left set on *Production* from when this
 * URL used to be staging, silently blocking all search indexing with
 * nothing surfacing it — go-live.mjs's own smoke check only asserted a 200
 * response. This just makes that state loud (a boot-time console.warn) so
 * a leftover var can't slip by unnoticed again; scripts/go-live.mjs's
 * smoke stage additionally fails a would-be silent success after deploy.
 */
function warnIfProductionBlocksIndexing(): void {
  if (isVercelProduction() && process.env.NEXT_PUBLIC_ALLOW_INDEXING === "false") {
    console.warn(
      "[env] NEXT_PUBLIC_ALLOW_INDEXING=false is set on Vercel PRODUCTION — this blocks all " +
        "search-engine indexing (robots.txt disallows /, every page is noindex). If this isn't " +
        "a deliberate soft launch, remove the variable from the Production scope and redeploy.",
    );
  }
}

/**
 * F-007 fix: NEXT_PUBLIC_SITE_URL feeds canonical/OG/sitemap URLs and every
 * emailed order/unsubscribe/back-in-stock link (see src/lib/seo/json-ld.ts,
 * src/lib/orders/notify.ts, src/lib/engagement/unsubscribe.ts,
 * src/lib/back-in-stock/index.ts). Vercel's team-scoped default alias
 * (`<project>-<team>-projects.vercel.app`) carries Deployment Protection
 * (an SSO wall) by default, unlike the project's own public
 * `<project>-<hash>.vercel.app` alias — pointing this var at the protected
 * one sends crawlers and customers alike to a Vercel login page instead of
 * the site. Warn only: a false positive here (a legitimately protected
 * custom setup) must never block a build.
 */
function warnIfSiteUrlLooksProtected(): void {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return;
  try {
    if (new URL(siteUrl).hostname.endsWith("-projects.vercel.app")) {
      console.warn(
        `[env] NEXT_PUBLIC_SITE_URL (${siteUrl}) looks like a Vercel team-scoped alias, which ` +
          "has Deployment Protection (SSO) enabled by default. Canonical links, the sitemap and " +
          "every emailed order/unsubscribe link would point anonymous visitors at a Vercel login " +
          "page. Set it to the project's public alias or the custom domain instead.",
      );
    }
  } catch {
    // Malformed URL — the https:// check below already throws in strict
    // mode for that; nothing more to warn about here.
  }
}

/**
 * Validates required environment variables at startup/build.
 * Strict failures only on Vercel production; CI/local builds warn instead.
 */
export function validateEnv(): void {
  warnIfProductionBlocksIndexing();
  warnIfSiteUrlLooksProtected();

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

    // Root key for encrypting admin-settable third-party credentials
    // (Razorpay/Brevo, see src/lib/integrations/credential-store.ts).
    // This is app-level infrastructure the operator sets once, like
    // AUTH_SECRET — not a rotating third-party credential — so it must
    // come from env, never be admin-editable, and must exist before any
    // credential can be stored or decrypted.
    const credentialEncryptionKey = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!credentialEncryptionKey) {
      throw new Error(
        "CREDENTIAL_ENCRYPTION_KEY must be set in production — generate one with " +
          "`node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"`",
      );
    }
    const decodedKeyLength = /^[0-9a-fA-F]{64}$/.test(credentialEncryptionKey)
      ? Buffer.from(credentialEncryptionKey, "hex").length
      : Buffer.from(credentialEncryptionKey, "base64").length;
    if (decodedKeyLength !== 32) {
      throw new Error(
        "CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (256 bits), as base64 or hex",
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

    // F-235 fix: mirrors the Razorpay warning below. A missing
    // BREVO_API_KEY here does not necessarily mean email is broken — an
    // admin may have entered a Brevo key in /admin/integrations, which
    // isIntegrationEnabled("BREVO") resolves from the database first (see
    // src/lib/integrations/status.ts). This must stay a warning, not a
    // throw: failing the build/boot on it would also break the
    // DB-credential-only setup that's meant to work. Its job is only to
    // make the "nothing set at all" case loud instead of silently leaving
    // password-reset, verify-email and order-confirmation mail queued in
    // stub mode (see src/lib/engagement/providers/email.ts) with nothing
    // surfacing it.
    if (!process.env.BREVO_API_KEY) {
      console.warn(
        "[env] BREVO_API_KEY is not set — transactional email (password reset, verify-email, " +
          "order confirmation) will use a Brevo key saved in /admin/integrations if one exists, " +
          "or otherwise stay in stub mode: emails are queued but never sent.",
      );
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
      ["R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID"],
      ["R2_ACCESS_KEY_ID", "CLOUDFLARE_ACCESS_KEY_ID", "CLOUDFLARE_ACCESS_KEY"],
      ["R2_SECRET_ACCESS_KEY", "CLOUDFLARE_SECRET_ACCESS_KEY"],
      ["R2_BUCKET"],
    ].filter((aliases) => !aliases.some((key) => process.env[key]));
    if (missingR2Vars.length > 0) {
      console.warn(
        `[env] Cloudflare R2 storage is not fully configured (missing: ${missingR2Vars.map((aliases) => aliases[0]).join(", ")}) — media upload and AI image storage will report as not configured`,
      );
    }

    // Razorpay (Phase D3): the three vars must be set together or not at
    // all. Missing all three is fine — checkout degrades to the
    // order-request fallback (isRazorpayConfigured() everywhere already
    // checks for this) — but having only some of them set almost always
    // means a copy-paste mistake that would otherwise silently leave
    // signature verification or webhook handling broken in production.
    const razorpayVars = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"];
    const razorpaySet = razorpayVars.filter((key) => process.env[key]);
    if (razorpaySet.length > 0 && razorpaySet.length < razorpayVars.length) {
      const missing = razorpayVars.filter((key) => !process.env[key]);
      throw new Error(
        `RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET must all be set together — missing: ${missing.join(", ")}`,
      );
    }
    if (razorpaySet.length === 0) {
      console.warn(
        "[env] Razorpay is not configured — checkout will fall back to the order-request flow",
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
