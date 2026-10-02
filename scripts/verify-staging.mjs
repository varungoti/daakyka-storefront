/**
 * Run smoke + core E2E + optional dogfood against a deployed staging URL.
 *
 * The E2E and dogfood suites write data, so this refuses the production store
 * (F-077) — it is the script that actually launches them, and it is run
 * directly as well as through verify:staging:full. `--production-readonly`
 * runs only the GET-only smoke tests, which is safe against production.
 *
 * Usage:
 *   TEST_BASE_URL=https://staging.example.com npm run verify:staging
 *   TEST_BASE_URL=https://staging.example.com npm run verify:staging -- --dogfood
 *   TEST_BASE_URL=https://<production-host> npm run verify:staging -- --production-readonly
 */
import { spawnSync } from "node:child_process";
import { productionTargetProblem } from "./lib/assert-not-production.mjs";

const base = process.env.TEST_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const withDogfood = process.argv.includes("--dogfood");
const readOnly = process.argv.includes("--production-readonly");

if (!base) {
  console.error("Set TEST_BASE_URL or PLAYWRIGHT_BASE_URL to your staging deployment.");
  process.exit(1);
}

const problem = productionTargetProblem(base, { readOnly });
if (problem) {
  console.error(`Refusing to run the staging verification: ${problem}`);
  process.exit(1);
}

const env = {
  ...process.env,
  TEST_BASE_URL: base,
  PLAYWRIGHT_BASE_URL: base,
  DISABLE_RATE_LIMIT: "1",
};

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Verifying staging deployment at ${base}`);

run("Smoke tests", "npm", ["run", "test:smoke"]);

if (readOnly) {
  console.log("\nProduction read-only verification passed (smoke only; no E2E or dogfood).");
  process.exit(0);
}

run("Core E2E", "npm", ["run", "test:e2e"]);

if (withDogfood) {
  run("Dogfood E2E", "npm", ["run", "test:dogfood"]);
}

console.log("\nStaging verification passed.");
