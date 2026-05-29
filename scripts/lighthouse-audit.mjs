/**
 * Lighthouse performance audit for key storefront URLs.
 * Requires: server running at LIGHTHOUSE_BASE_URL (default http://localhost:3000)
 *
 * Usage: npm run audit:lighthouse
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = process.env.LIGHTHOUSE_BASE_URL ?? "http://localhost:3000";
const OUT_DIR = "dogfood-output/lighthouse";
const PAGES = [
  "/",
  "/shop",
  "/about",
  "/institutional",
  "/products/v-neck-top-lilac",
  "/guides/medical-scrubs",
];

const THRESHOLDS = {
  performance: 0.9,
  accessibility: 0.9,
  "best-practices": 0.9,
  seo: 0.9,
};

async function waitForServer(url, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Server not reachable at ${url}. Run: npm run dev`);
}

function runLighthouse(url, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      "--output=json",
      `--output-path=${outputPath}`,
      "--chrome-flags=--headless --no-sandbox",
      "--only-categories=performance,accessibility,best-practices,seo",
      "--quiet",
    ];
    const child = spawn("npx", ["lighthouse", ...args], {
      shell: true,
      stdio: "inherit",
    });
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`lighthouse exit ${code}`))));
  });
}

function scoreFromReport(report) {
  const cats = report.categories ?? {};
  return Object.fromEntries(
    Object.entries(THRESHOLDS).map(([key]) => [
      key,
      cats[key]?.score ?? 0,
    ]),
  );
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await waitForServer(BASE);

  const results = [];

  for (const path of PAGES) {
    const url = `${BASE.replace(/\/$/, "")}${path}`;
    const slug = path === "/" ? "home" : path.replace(/\//g, "-").slice(1);
    const jsonPath = join(OUT_DIR, `${slug}.report.json`);
    console.log(`\nAuditing ${url}...`);
    await runLighthouse(url, jsonPath);

    const raw = JSON.parse(await readFile(jsonPath, "utf8"));
    const scores = scoreFromReport(raw);
    const row = { path, url, scores };
    results.push(row);

    for (const [cat, min] of Object.entries(THRESHOLDS)) {
      const actual = scores[cat];
      const status = actual >= min ? "PASS" : "WARN";
      console.log(`  ${cat}: ${(actual * 100).toFixed(0)} (${status}, target ${min * 100})`);
    }
  }

  const md = [
    "# Lighthouse Audit",
    "",
    `**Date:** ${new Date().toISOString().slice(0, 10)}`,
    `**Base URL:** ${BASE}`,
    "",
    "| Page | Performance | Accessibility | Best Practices | SEO |",
    "|------|-------------|---------------|----------------|-----|",
    ...results.map(
      (r) =>
        `| ${r.path} | ${pct(r.scores.performance)} | ${pct(r.scores.accessibility)} | ${pct(r.scores["best-practices"])} | ${pct(r.scores.seo)} |`,
    ),
    "",
    "Target: all categories ≥ 90.",
    "",
    "Raw JSON reports in `dogfood-output/lighthouse/`.",
  ].join("\n");

  await writeFile(join(OUT_DIR, "summary.md"), md);
  console.log(`\nSummary written to ${join(OUT_DIR, "summary.md")}`);
}

function pct(n) {
  return `${Math.round((n ?? 0) * 100)}`;
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
