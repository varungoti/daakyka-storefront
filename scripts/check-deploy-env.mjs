/**
 * Validate staging/production env before deploy.
 * Usage: node scripts/check-deploy-env.mjs [--production]
 */
import { createHash } from "node:crypto";
import { databaseUrlSslModeIssue } from "./lib/deploy-checks.mjs";

const isProduction = process.argv.includes("--production");

// Kept in sync with src/lib/auth/seed-defaults.ts's deny-list
// (duplicated rather than imported: this script runs via plain `node`,
// before any TypeScript loader is available).
const INSECURE_SEED_PASSWORDS = new Set(["password", "changeme", "admin", "admin123"]);

// F-301: these project's real, once-published SUPER_ADMIN/VIEWER seed
// defaults are deny-listed by SHA-256 digest, not by value, so the leaked
// plaintext is never reintroduced here. See src/lib/auth/seed-defaults.ts.
const LEAKED_SEED_PASSWORD_DIGESTS = new Set([
  "c60122eef0f379572315898a19084a6b36ff05333fc6adf0c648e9777f5e6adb",
  "1c7da5b5e8f47830852c97475be97424745f5ffe6bb2e04e5736bb8a6ab2233e",
]);

function isInsecureSeedPassword(password) {
  return (
    password.length < 12 ||
    INSECURE_SEED_PASSWORDS.has(password) ||
    LEAKED_SEED_PASSWORD_DIGESTS.has(createHash("sha256").update(password, "utf8").digest("hex"))
  );
}

// F-348: this script only ever validated 5 of the vars src/lib/env.ts's
// validateEnv() hard-requires in production — CREDENTIAL_ENCRYPTION_KEY
// (the root key for /admin/integrations credential encryption) was
// missing entirely, so a green `check:deploy-env` never meant "every var
// production needs is set," despite GO_LIVE_RUNBOOK.md's own caveat about
// exactly that gap.
const required = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "CRON_SECRET",
  "NEXT_PUBLIC_SITE_URL",
  "ADMIN_SEED_PASSWORD",
  "CREDENTIAL_ENCRYPTION_KEY",
];

console.log(
  `Checking the current shell environment (not the values stored in Vercel) — ${
    isProduction ? "production" : "staging"
  } mode.\n`,
);

const errors = [];
const warnings = [];

for (const key of required) {
  const value = process.env[key];
  if (!value) {
    errors.push(`Missing ${key}`);
    continue;
  }
  if (key === "AUTH_SECRET" && value.length < 32) {
    errors.push("AUTH_SECRET must be at least 32 characters");
  }
  if (key === "DATABASE_URL" && isProduction && value.startsWith("file:")) {
    errors.push("DATABASE_URL must be Postgres in production (not SQLite file:)");
  }
  if (key === "ADMIN_SEED_PASSWORD" && isInsecureSeedPassword(value)) {
    errors.push(
      "ADMIN_SEED_PASSWORD is too short or matches a known default/leaked password",
    );
  }
  if (key === "NEXT_PUBLIC_SITE_URL" && isProduction && !value.startsWith("https://")) {
    errors.push("NEXT_PUBLIC_SITE_URL must be an https:// URL in production");
  }
  if (key === "CREDENTIAL_ENCRYPTION_KEY") {
    const decodedLength = /^[0-9a-fA-F]{64}$/.test(value)
      ? Buffer.from(value, "hex").length
      : Buffer.from(value, "base64").length;
    if (decodedLength !== 32) {
      errors.push("CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes, as base64 or hex");
    }
  }
}

// F-371: pg prints a SECURITY WARNING on every cold start for
// sslmode=prefer/require/verify-ca, and pg v9 will give those weaker libpq
// semantics. A warning, not an error: src/lib/env.ts only warns at boot for
// the same reason, and the fix (editing the Vercel env var) is the owner's.
if (isProduction) {
  const sslIssue = databaseUrlSslModeIssue(process.env.DATABASE_URL);
  if (sslIssue === "missing") {
    warnings.push("DATABASE_URL has no sslmode - the database connection may be unencrypted. Add sslmode=verify-full.");
  } else if (sslIssue === "legacy-alias") {
    warnings.push(
      "DATABASE_URL uses sslmode=prefer/require/verify-ca, which pg v9 will weaken to libpq semantics. " +
        "Use sslmode=verify-full: on pg 8 it is exactly what require/prefer/verify-ca already do.",
    );
  } else if (sslIssue === "unverified") {
    warnings.push("DATABASE_URL uses an sslmode that does not verify the server certificate. Use sslmode=verify-full.");
  }
}

if (!isProduction && process.env.NEXT_PUBLIC_ALLOW_INDEXING !== "false") {
  errors.push("Set NEXT_PUBLIC_ALLOW_INDEXING=false on staging");
}

// F-054 fix: this is the flip side of the staging check above — a value
// left over from when a URL used to be staging (or copy-pasted into
// Production by mistake) silently blocks all search indexing there, with
// nothing else in the deploy path checking for it. NEXT_PUBLIC_ALLOW_INDEXING
// is a legitimate soft-launch switch (src/lib/env.ts's isIndexingAllowed),
// so this only fails the explicit, operator-run `npm run check:deploy-env`
// gate — never the build/boot path (src/lib/env.ts's validateEnv only
// warns there) — an operator who really wants a noindexed production
// deployment can still ship one by not running this check.
if (isProduction && process.env.NEXT_PUBLIC_ALLOW_INDEXING === "false") {
  errors.push(
    "NEXT_PUBLIC_ALLOW_INDEXING=false blocks all search indexing in production — remove it " +
      "unless this is a deliberate soft launch",
  );
}

const shopifyConfigured =
  process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN &&
  process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN;

if (shopifyConfigured && !process.env.SHOPIFY_WEBHOOK_SECRET) {
  errors.push("SHOPIFY_WEBHOOK_SECRET required when Shopify Storefront is configured");
}

if (process.env.BREVO_API_KEY && !process.env.BREVO_FROM_EMAIL) {
  errors.push("BREVO_FROM_EMAIL required when BREVO_API_KEY is configured");
}

if (warnings.length > 0) {
  console.warn("Deploy environment warnings (not blocking):\n");
  for (const warning of warnings) {
    console.warn(`  - ${warning}`);
  }
  console.warn("");
}

if (errors.length > 0) {
  console.error("Deploy environment check failed:\n");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  console.error("\nSee .env.staging.example and docs/STAGING_DEPLOY.md");
  process.exit(1);
}

console.log(`Deploy environment OK (${isProduction ? "production" : "staging"}).`);
