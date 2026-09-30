/** Run local Docker CI, then deploy and audit the public Vercel alias. */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const deploy = process.argv.includes("--deploy");
const publicUrl = new URL(process.env.RELEASE_PUBLIC_URL ?? "https://storefront-nu-woad.vercel.app");

function git(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

async function run(name, program, args) {
  console.log(`\n==> ${name}`);
  await new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${name} failed (${code})`)));
  });
}

async function checkHealth() {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const response = await fetch(new URL("/api/health", publicUrl), {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json();
    rows.push({ status: response.status, health: body.status });
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  const products = await fetch(new URL("/api/products", publicUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (rows.some((row) => row.status !== 200 || row.health !== "ok") || products.status !== 200) {
    throw new Error(`Public health failed: ${JSON.stringify({ rows, productsStatus: products.status })}`);
  }
  console.log(`Public health: 5/5 OK; products API: ${products.status}`);
}

if (git(["status", "--porcelain"]).length > 0) {
  throw new Error("Release requires a clean worktree; preserve or commit local changes first");
}
const sourceSha = git(["rev-parse", "HEAD"]);
await run("Docker CI", "node", ["scripts/local-ci.mjs"]);
const ci = JSON.parse(readFileSync("dogfood-output/local-ci/report.json", "utf8"));
if (!ci.ok || ci.mode !== "full" || ci.sourceSha !== sourceSha) {
  throw new Error("Full Docker CI did not verify the current commit");
}
await run("AR Docker image and tests", "node", ["scripts/local-ar-ci.mjs"]);

if (!deploy) {
  console.log("Docker CI passed. Use --deploy to publish this verified revision.");
  process.exit(0);
}

await run("Vercel production deployment", "vercel", ["deploy", "--prod", "--yes"]);
await checkHealth();
await run("All visible menu categories", "npx", ["tsx", "scripts/audit-live-categories.ts", publicUrl.href]);
await run("Public sitemap, links, and image targets", "node", ["scripts/audit-public-links.mjs", publicUrl.href]);
await checkHealth();

const evidence = {
  sourceSha,
  publicUrl: publicUrl.href,
  ciReport: "dogfood-output/local-ci/report.json",
  verifiedAt: new Date().toISOString(),
  result: "production alias health, products, categories, links and images passed",
};
writeFileSync("dogfood-output/local-ci/deployment-report.json", `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`Production verification passed for ${sourceSha}`);
