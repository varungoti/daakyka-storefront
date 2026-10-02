/**
 * Full staging gate: deploy probe + smoke + E2E + dogfood against a live URL.
 *
 * The E2E and dogfood suites write data (homepage hero edits, blog drafts,
 * Hermes tasks), so this gate needs a real Preview/staging deployment and has
 * NO default target. It refuses the production store (F-077): the old default,
 * https://storefront-nu-woad.vercel.app, IS production.
 *
 * Usage:
 *   TEST_BASE_URL=https://<preview-or-staging-host> npm run verify:staging:full
 *   TEST_BASE_URL=https://<production-host> npm run verify:staging:full -- --production-readonly
 *
 * --production-readonly runs only the GET-only deploy probe and smoke tests,
 * so it is the one mode that may point at production. It does not stamp
 * dogfood-output/COMPLETION.json: that stamp records a staging verification.
 */
import { spawnSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { productionTargetProblem } from "./lib/assert-not-production.mjs";

const base = process.env.TEST_BASE_URL ?? process.env.STAGING_URL;
const readOnly = process.argv.includes("--production-readonly");

if (!base) {
  console.error(
    "Set TEST_BASE_URL (or STAGING_URL) to the Preview/staging deployment to verify. " +
      "There is deliberately no default: the old one was the production store.",
  );
  process.exit(1);
}

const problem = productionTargetProblem(base, { readOnly });
if (problem) {
  console.error(`Refusing to run the staging gate: ${problem}`);
  process.exit(1);
}

const env = { ...process.env, TEST_BASE_URL: base, STAGING_URL: base };

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`${readOnly ? "Production read-only gate" : "Staging full gate"}: ${base}`);

if (readOnly) {
  // No --staging (production is meant to be indexable), no write probes, and
  // no Playwright suite: only requests that cannot change anything.
  run("Deploy probe (GET-only)", "npm", ["run", "probe:deploy"]);
  run("Smoke tests (GET-only)", "npm", ["run", "test:smoke"]);
  console.log("\nProduction read-only checks passed. Nothing was written; COMPLETION.json was not updated.");
  process.exit(0);
}

run("Deploy probe", "npm", ["run", "probe:deploy", "--", "--staging"]);
run("Staging smoke + E2E + dogfood", "npm", ["run", "verify:staging", "--", "--dogfood"]);

await mkdir("dogfood-output", { recursive: true });

let completion = {};
try {
  completion = JSON.parse(await readFile(join("dogfood-output", "COMPLETION.json"), "utf8"));
} catch {
  /* fresh stamp */
}

const stamp = {
  ...completion,
  stagingVerifiedAt: new Date().toISOString(),
  stagingUrl: base,
  stagingGate: "verify:staging:full",
  deployProbe: "passed",
  remoteDogfood: "passed",
};

await writeFile(join("dogfood-output", "COMPLETION.json"), JSON.stringify(stamp, null, 2));

console.log("\nStaging full gate passed.");
console.log(`Updated dogfood-output/COMPLETION.json (stagingVerifiedAt).`);
