/**
 * Run smoke + core E2E + optional dogfood against a deployed staging URL.
 *
 * Usage:
 *   TEST_BASE_URL=https://staging.example.com npm run verify:staging
 *   TEST_BASE_URL=https://staging.example.com npm run verify:staging -- --dogfood
 */
import { spawnSync } from "node:child_process";

const base = process.env.TEST_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL;
const withDogfood = process.argv.includes("--dogfood");

if (!base) {
  console.error("Set TEST_BASE_URL or PLAYWRIGHT_BASE_URL to your staging deployment.");
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
run("Core E2E", "npm", ["run", "test:e2e"]);

if (withDogfood) {
  run("Dogfood E2E", "npm", ["run", "test:dogfood"]);
}

console.log("\nStaging verification passed.");
