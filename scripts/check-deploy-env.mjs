/**
 * Validate staging/production env before deploy.
 * Usage: node scripts/check-deploy-env.mjs [--production]
 */
const isProduction = process.argv.includes("--production");

// Kept in sync with src/lib/auth/seed-defaults.ts's INSECURE_SEED_PASSWORDS
// (duplicated rather than imported: this script runs via plain `node`,
// before any TypeScript loader is available).
const INSECURE_SEED_PASSWORDS = new Set([
  "Daakyka@2026",
  "Daakyka@Viewer2026",
  "password",
  "changeme",
  "admin",
  "admin123",
]);

function isInsecureSeedPassword(password) {
  return password.length < 12 || INSECURE_SEED_PASSWORDS.has(password);
}

const required = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "CRON_SECRET",
  "NEXT_PUBLIC_SITE_URL",
  "ADMIN_SEED_PASSWORD",
];

const errors = [];

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
}

if (!isProduction && process.env.NEXT_PUBLIC_ALLOW_INDEXING !== "false") {
  errors.push("Set NEXT_PUBLIC_ALLOW_INDEXING=false on staging");
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

if (errors.length > 0) {
  console.error("Deploy environment check failed:\n");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  console.error("\nSee .env.staging.example and docs/STAGING_DEPLOY.md");
  process.exit(1);
}

console.log(`Deploy environment OK (${isProduction ? "production" : "staging"}).`);
