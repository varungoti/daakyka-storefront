/**
 * Push the local .env values this app needs into Vercel Production.
 *
 * Why this exists: the production variable names don't all match the local
 * ones. `DATABASE_URL` locally points at the Docker Postgres used for tests,
 * while production needs the Supabase session-pooler string that lives under
 * `SUPABASE_DATABASE_URL`; the R2 credentials are stored under their
 * `CLOUDFLARE_*` names. Copying by hand gets that mapping wrong in exactly
 * the way that silently boots production against the wrong database.
 *
 * Usage:
 *   node scripts/push-env-to-vercel.mjs            # dry run: show the plan
 *   node scripts/push-env-to-vercel.mjs --apply    # actually write to Vercel
 *
 * Values are streamed to `vercel env add` over stdin and are never printed,
 * logged, or written anywhere by this script.
 */
import { spawnSync } from "node:child_process";
import { readEnvFile } from "./lib/read-env-file.mjs";

const APPLY = process.argv.includes("--apply");
const TARGET = "production";

let env;
try {
  env = readEnvFile(".env");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

/** production var name -> local .env key it is sourced from */
const MAPPING = [
  { prod: "DATABASE_URL", from: "SUPABASE_DATABASE_URL", replace: true },
  { prod: "ADMIN_SEED_PASSWORD", from: "ADMIN_SEED_PASSWORD" },
  { prod: "CREDENTIAL_ENCRYPTION_KEY", from: "CREDENTIAL_ENCRYPTION_KEY" },
  { prod: "OPENAI_API_KEY", from: "OPENAI_API_KEY" },
  { prod: "R2_ACCOUNT_ID", from: "R2_ACCOUNT_ID" },
  { prod: "R2_ACCESS_KEY_ID", from: "CLOUDFLARE_ACCESS_KEY_ID" },
  { prod: "R2_SECRET_ACCESS_KEY", from: "CLOUDFLARE_SECRET_ACCESS_KEY" },
];

/** Sanity checks that would otherwise only surface as a failed build. */
function validate(prod, value) {
  if (prod === "ADMIN_SEED_PASSWORD") {
    const blocked = new Set([
      "Daakyka@2026",
      "Daakyka@Viewer2026",
      "password",
      "changeme",
      "admin",
      "admin123",
    ]);
    if (value.length < 12) return `too short (${value.length} chars, needs >= 12)`;
    if (blocked.has(value)) return "matches a known default password";
  }
  if (prod === "DATABASE_URL") {
    if (!value.startsWith("postgres")) return "is not a postgres:// URL";
    if (value.includes("localhost")) return "points at localhost, not Supabase";
  }
  if (prod === "CREDENTIAL_ENCRYPTION_KEY") {
    const bytes = /^[0-9a-fA-F]{64}$/.test(value)
      ? Buffer.from(value, "hex").length
      : Buffer.from(value, "base64").length;
    if (bytes !== 32) return `decodes to ${bytes} bytes, needs exactly 32`;
  }
  return null;
}

const plan = [];
const problems = [];

for (const entry of MAPPING) {
  const value = env.get(entry.from);
  if (!value) {
    problems.push(`${entry.prod}: source ${entry.from} is missing from .env`);
    continue;
  }
  const bad = validate(entry.prod, value);
  if (bad) {
    problems.push(`${entry.prod}: ${bad}`);
    continue;
  }
  plan.push({ ...entry, value });
}

console.log(`Plan for Vercel ${TARGET}:\n`);
for (const item of plan) {
  const action = item.replace ? "replace" : "add";
  console.log(
    `  ${action.padEnd(8)} ${item.prod.padEnd(26)} (from ${item.from}, ${item.value.length} chars)`,
  );
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s) — these will NOT be pushed:\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
}

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to write these to Vercel.");
  process.exit(problems.length > 0 ? 1 : 0);
}

if (plan.length === 0) {
  console.error("\nNothing to push.");
  process.exit(1);
}

console.log("");
let failed = 0;

for (const item of plan) {
  if (item.replace) {
    // Ignore failure: the variable may simply not exist yet.
    spawnSync("npx", ["vercel", "env", "rm", item.prod, TARGET, "--yes"], {
      stdio: ["ignore", "ignore", "ignore"],
      shell: true,
    });
  }
  const result = spawnSync("npx", ["vercel", "env", "add", item.prod, TARGET], {
    input: item.value,
    stdio: ["pipe", "ignore", "pipe"],
    shell: true,
  });
  const ok = result.status === 0;
  if (!ok) failed += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${item.prod}`);
  if (!ok && result.stderr) {
    // stderr from `vercel env add` echoes only the variable name, not the value.
    console.log(`        ${String(result.stderr).trim().split("\n").slice(-2).join(" ")}`);
  }
}

console.log(
  failed === 0
    ? `\nDone. Verify with: npx vercel env ls ${TARGET}`
    : `\n${failed} variable(s) failed — see above.`,
);
process.exit(failed === 0 && problems.length === 0 ? 0 : 1);
