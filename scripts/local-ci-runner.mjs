/** Runs inside the isolated Docker CI image. */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const sourceSha = process.env.CI_SOURCE_SHA;
const browserOnly = process.argv.includes("--browser-only");
if (!sourceSha || !/^[a-f0-9]{40}$/.test(sourceSha)) {
  throw new Error("CI_SOURCE_SHA must be supplied by scripts/local-ci.mjs");
}

const stages = [];
const startedAt = new Date().toISOString();
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const reportPath = "dogfood-output/report.json";
mkdirSync("dogfood-output", { recursive: true });

function run(name, program, args, extraEnv = {}) {
  console.log(`\n==> ${name}`);
  const started = Date.now();
  const result = spawnSync(program, args, {
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
  });
  stages.push({ name, ok: result.status === 0, durationMs: Date.now() - started });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} failed (${result.status})`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Built server did not become healthy at ${base}`);
}

let server;
let error;
try {
  if (!browserOnly) {
    run("Production dependency audit", "npm", ["audit", "--omit=dev", "--audit-level=critical"]);
  }
  run("Database migration and seed", "npm", ["run", "db:setup"]);
  // The application seed deliberately leaves catalog products in DRAFT.
  // CI needs a disposable published catalog to verify real menu listings.
  run("Publish disposable CI catalog", "npm", ["run", "db:seed:catalog", "--", "--publish"]);
  if (!browserOnly) {
    run("Lint", "npm", ["run", "lint"]);
    run("Typecheck", "npm", ["run", "typecheck"]);
  run("Unit and integration tests", "npm", ["run", "test"]);
  }
  run("Enable optional pages in disposable CI catalog", "npx", ["tsx", "scripts/enable-ci-browser-features.ts"]);
  process.env.CI_OPTIONAL_PAGES_ENABLED = "1";
  run("Production build", "npm", ["run", "build"]);

  server = spawn("npm", ["run", "start"], {
    stdio: "inherit",
    env: { ...process.env, DISABLE_RATE_LIMIT: "1" },
  });
  await waitForServer();
  stages.push({ name: "Built server health", ok: true });

  run("Smoke", "npm", ["run", "test:smoke"]);
  run("Core browser journeys", "npm", ["run", "test:e2e"]);
  run("Dogfood browser journeys", "npm", ["run", "test:dogfood"], {
    DISABLE_RATE_LIMIT: "1",
  });
  run("Accessibility", "npm", ["run", "test:a11y"]);
  run("Lighthouse mobile", "npm", ["run", "test:lighthouse"], {
    CHROME_PATH: chromium.executablePath(),
  });
  run("Local sitemap, links, and image targets", "node", ["scripts/audit-public-links.mjs", base]);
} catch (caught) {
  error = caught instanceof Error ? caught.message : String(caught);
  console.error(error);
} finally {
  if (server && !server.killed) server.kill("SIGTERM");
  const report = {
    ok: !error,
    mode: browserOnly ? "browser-only" : "full",
    sourceSha,
    startedAt,
    finishedAt: new Date().toISOString(),
    stages,
    ...(error ? { error } : {}),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

if (error) process.exitCode = 1;
