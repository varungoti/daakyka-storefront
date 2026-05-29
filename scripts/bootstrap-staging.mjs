/**
 * Generate staging secrets and print Vercel env setup commands.
 * Does not create cloud resources — safe to run locally anytime.
 *
 * Usage:
 *   npm run bootstrap:staging
 *   npm run bootstrap:staging -- --json   # machine-readable output
 */
import { randomBytes } from "node:crypto";

const asJson = process.argv.includes("--json");

const authSecret = randomBytes(32).toString("hex");
const cronSecret = randomBytes(24).toString("hex");
const adminPassword = `Dk@${randomBytes(4).toString("hex")}!${randomBytes(2).toString("hex").toUpperCase()}`;

const env = {
  DATABASE_URL: "postgresql://USER:PASSWORD@HOST:5432/daakyka_staging?sslmode=require",
  AUTH_SECRET: authSecret,
  CRON_SECRET: cronSecret,
  NEXT_PUBLIC_SITE_URL: "https://YOUR-PROJECT.vercel.app",
  NEXT_PUBLIC_ALLOW_INDEXING: "false",
  ADMIN_SEED_EMAIL: "varungoti@gmail.com",
  ADMIN_SEED_PASSWORD: adminPassword,
};

if (asJson) {
  console.log(JSON.stringify(env, null, 2));
  process.exit(0);
}

console.log("\nDAAKYKA Staging Bootstrap\n");
console.log("1. Create Neon Postgres → copy connection string into DATABASE_URL");
console.log("2. Import storefront/ to Vercel (Root Directory = storefront)");
console.log("3. Add these env vars (Preview + Production for staging branch):\n");

for (const [key, value] of Object.entries(env)) {
  console.log(`${key}=${value}`);
}

console.log("\n4. Deploy staging branch, then:\n");
console.log("   npm run go-live:check");
console.log("   TEST_BASE_URL=https://YOUR-PROJECT.vercel.app npm run probe:deploy -- --staging");
console.log("   TEST_BASE_URL=https://YOUR-PROJECT.vercel.app npm run verify:staging -- --dogfood");
console.log("\n5. Change admin password after first login.\n");
console.log("Full guide: docs/GO_LIVE_RUNBOOK.md\n");
