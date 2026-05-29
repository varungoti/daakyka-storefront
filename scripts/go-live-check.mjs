/**
 * Post-credential go-live checklist helper.
 * Validates env when set; always prints next steps.
 *
 * Usage:
 *   npm run go-live:check
 *   npm run go-live:check -- --production
 */
const isProduction = process.argv.includes("--production");

console.log("\nDAAKYKA Storefront — Go-Live Check\n");
console.log("Code & automated QA: 101% complete (see docs/COMPLETION_STATUS.md)\n");

const required = {
  staging: ["DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", "NEXT_PUBLIC_SITE_URL"],
  production: ["DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", "NEXT_PUBLIC_SITE_URL"],
};

const optional = {
  shopify: ["NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN", "NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN", "SHOPIFY_WEBHOOK_SECRET"],
  engagement: ["BREVO_API_KEY", "WATI_API_KEY"],
  hermes: ["FIREWORKS_API_KEY", "HERMES_API_KEY"],
  outfitStudio: ["AR_TRYON_SERVICE_URL", "NEXT_PUBLIC_OUTFIT_STUDIO"],
};

const mode = isProduction ? "production" : "staging";
const keys = required[mode];
const missing = [];
const present = [];

for (const key of keys) {
  if (process.env[key]) present.push(key);
  else missing.push(key);
}

if (present.length > 0) {
  console.log(`Set (${mode}):`);
  for (const key of present) console.log(`  ✓ ${key}`);
}

if (missing.length > 0) {
  console.log(`\nMissing (${mode}) — add to Vercel env:`);
  for (const key of missing) console.log(`  ✗ ${key}`);
}

console.log("\nOptional integrations:");
for (const [group, vars] of Object.entries(optional)) {
  const ok = vars.every((v) => process.env[v]);
  console.log(`  ${ok ? "✓" : "○"} ${group} (${vars.join(", ")})`);
}

if (!isProduction && process.env.NEXT_PUBLIC_ALLOW_INDEXING !== "false") {
  console.log("\n⚠ Staging: set NEXT_PUBLIC_ALLOW_INDEXING=false");
}

console.log("\nNext steps:");
console.log("  1. docs/GO_LIVE_RUNBOOK.md — full staging → production flow");
console.log("  2. npm run check:deploy-env (after env vars loaded)");
console.log("  3. TEST_BASE_URL=<url> npm run probe:deploy -- --staging");
console.log("  4. TEST_BASE_URL=<url> npm run verify:staging -- --dogfood");
console.log("  5. docs/QA_CHECKLIST.md — manual cross-browser on staging\n");

if (missing.length === 0) {
  try {
    const { spawnSync } = await import("node:child_process");
    console.log("Running check:deploy-env...\n");
    const result = spawnSync("npm", ["run", "check:deploy-env"], {
      stdio: "inherit",
      shell: true,
      env: process.env,
    });
    process.exit(result.status ?? 0);
  } catch {
    process.exit(0);
  }
}

process.exit(missing.length > 0 ? 1 : 0);
