/**
 * One-command production go-live.
 *
 * Runs, in the only order that is safe:
 *   1. preflight   — validate what's in .env before anything leaves the machine
 *   2. env         — push the local values to Vercel under their PRODUCTION names
 *   3. migrate     — apply pending migrations to the Supabase database
 *   4. deploy      — vercel --prod
 *   5. smoke       — fetch the deployed site and check it answers 200
 *
 * Order matters. The migrations are additive, so applying them before the
 * deploy leaves the currently-live build working (it simply ignores the new
 * tables), whereas deploying first would put code live that queries
 * EmailOutbox and Order.accessTokenHash against a database that has neither.
 *
 * Usage:
 *   node scripts/go-live.mjs            # dry run — shows the plan, changes nothing
 *   node scripts/go-live.mjs --yes      # actually go live
 *   node scripts/go-live.mjs --yes --skip-env   # env already correct on Vercel
 *
 * Secrets are passed to child processes via stdin or the child's env and are
 * never printed, logged, or written to disk by this script.
 */
import { spawnSync } from "node:child_process";
import { readEnvFile } from "./lib/read-env-file.mjs";

const APPLY = process.argv.includes("--yes");
const SKIP_ENV = process.argv.includes("--skip-env");
const SKIP_MIGRATE = process.argv.includes("--skip-migrate");

let env;
try {
  env = readEnvFile(".env");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

let step = 0;
function stage(name) {
  step += 1;
  console.log(`\n${"=".repeat(64)}\n  ${step}. ${name}\n${"=".repeat(64)}`);
}

function die(message) {
  console.error(`\nABORTED: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- preflight
stage("Preflight");

const supabaseUrl = env.get("SUPABASE_DATABASE_URL");
if (!supabaseUrl) {
  die(
    "SUPABASE_DATABASE_URL is missing from .env.\n" +
      "It holds the production Supabase session-pooler string. If .env only has\n" +
      "DATABASE_URL pointing at Supabase, rename it back to SUPABASE_DATABASE_URL\n" +
      "and restore the local Postgres URL under DATABASE_URL — otherwise every\n" +
      "test run in this repo writes to production.",
  );
}

let supabaseHost;
try {
  supabaseHost = new URL(supabaseUrl).hostname;
} catch {
  die("SUPABASE_DATABASE_URL is not a parseable URL.");
}
if (supabaseHost.includes("localhost")) {
  die("SUPABASE_DATABASE_URL points at localhost — that is not the production database.");
}

const localUrl = env.get("DATABASE_URL");
if (localUrl) {
  const localHost = new URL(localUrl).hostname;
  if (localHost === supabaseHost) {
    die(
      "DATABASE_URL and SUPABASE_DATABASE_URL both point at production.\n" +
        "Restore DATABASE_URL to the local Postgres before going live, or the next\n" +
        "`npm test` in this repo will run against live customer data.",
    );
  }
  console.log(`  DATABASE_URL (local tests)   -> ${localHost}`);
}
console.log(`  SUPABASE_DATABASE_URL (prod) -> ${supabaseHost}`);

const seedPassword = env.get("ADMIN_SEED_PASSWORD");
if (!seedPassword) die("ADMIN_SEED_PASSWORD is missing from .env.");
if (seedPassword.length < 12) {
  die(
    `ADMIN_SEED_PASSWORD parses to ${seedPassword.length} characters, but production ` +
      `requires at least 12.\nIf it contains a '#', wrap the value in double quotes — ` +
      `unquoted, dotenv treats '#' as the start of a comment and truncates it.`,
  );
}
console.log(`  ADMIN_SEED_PASSWORD          -> ${seedPassword.length} chars, ok`);

const encryptionKey = env.get("CREDENTIAL_ENCRYPTION_KEY");
if (!encryptionKey) die("CREDENTIAL_ENCRYPTION_KEY is missing from .env.");
const keyBytes = /^[0-9a-fA-F]{64}$/.test(encryptionKey)
  ? Buffer.from(encryptionKey, "hex").length
  : Buffer.from(encryptionKey, "base64").length;
if (keyBytes !== 32) die(`CREDENTIAL_ENCRYPTION_KEY decodes to ${keyBytes} bytes, needs 32.`);
console.log(`  CREDENTIAL_ENCRYPTION_KEY    -> 32 bytes, ok`);

if (!APPLY) {
  console.log(
    "\nDry run — nothing was changed.\n\n" +
      "Would then:\n" +
      "  2. push DATABASE_URL, ADMIN_SEED_PASSWORD, CREDENTIAL_ENCRYPTION_KEY,\n" +
      "     OPENAI_API_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY\n" +
      "     to Vercel production\n" +
      `  3. apply pending Prisma migrations to ${supabaseHost}\n` +
      "  4. npx vercel --prod\n" +
      "  5. smoke-check the deployed site\n\n" +
      "Re-run with --yes to go live.",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------- env
if (SKIP_ENV) {
  stage("Vercel environment variables (skipped)");
} else {
  stage("Vercel environment variables");
  const result = spawnSync(
    process.execPath,
    ["scripts/push-env-to-vercel.mjs", "--apply"],
    { stdio: "inherit" },
  );
  if (result.status !== 0) die("pushing environment variables failed — see above.");
}

// ------------------------------------------------------------------ migrate
if (SKIP_MIGRATE) {
  stage("Database migrations (skipped)");
} else {
  stage(`Database migrations -> ${supabaseHost}`);
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    // Override only for this child. The parent's .env-backed DATABASE_URL,
    // which points at the local test database, is left untouched.
    env: { ...process.env, DATABASE_URL: supabaseUrl },
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) die("migrations failed — production was NOT deployed.");
}

// ------------------------------------------------------------------- deploy
stage("Deploy to Vercel production");
const deploy = spawnSync("npx", ["vercel", "--prod", "--yes"], {
  encoding: "utf8",
  shell: true,
});
process.stdout.write(deploy.stdout ?? "");
process.stderr.write(deploy.stderr ?? "");
if (deploy.status !== 0) die("vercel --prod failed — see above.");

const combined = `${deploy.stdout ?? ""}\n${deploy.stderr ?? ""}`;
const deployedUrl =
  combined.match(/https:\/\/[^\s]*\.vercel\.app/g)?.at(-1) ??
  env.get("NEXT_PUBLIC_SITE_URL") ??
  null;

// -------------------------------------------------------------------- smoke
stage("Smoke check");
if (!deployedUrl) {
  console.log("  Could not determine the deployment URL — check the Vercel dashboard.");
  process.exit(0);
}

console.log(`  GET ${deployedUrl}`);
try {
  const response = await fetch(deployedUrl, { redirect: "follow" });
  const body = await response.text();
  const ok = response.status === 200;
  console.log(`  -> ${response.status} ${response.statusText}, ${body.length} bytes`);
  if (!ok) die(`the deployed site answered ${response.status}.`);
  if (!/DAAKYKA/i.test(body)) {
    console.log("  WARNING: response did not contain 'DAAKYKA' — check the page manually.");
  }
  console.log(`\nLive: ${deployedUrl}`);
} catch (error) {
  die(`could not reach the deployed site: ${error.message}`);
}
