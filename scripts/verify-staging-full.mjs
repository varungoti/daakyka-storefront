/**
 * Full staging gate: deploy probe + smoke + E2E + dogfood against live URL.
 *
 * Usage:
 *   TEST_BASE_URL=https://storefront-nu-woad.vercel.app npm run verify:staging:full
 */
import { spawnSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readFile } from "node:fs/promises";

const base =
  process.env.TEST_BASE_URL ??
  process.env.STAGING_URL ??
  "https://storefront-nu-woad.vercel.app";

const env = { ...process.env, TEST_BASE_URL: base, STAGING_URL: base };

function run(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: true });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Staging full gate: ${base}`);

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
