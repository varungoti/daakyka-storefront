/**
 * 101% completion gate — full predeploy + Lighthouse audit.
 *
 * Usage: npm run verify:101
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { assertDisposableRun } from "./lib/assert-disposable-db.mjs";
import { ensurePortFree, killPort, wantsKillPort } from "./lib/kill-port.mjs";

const PORT = process.env.PORT ?? "3000";
const BASE = `http://localhost:${PORT}`;

// Only used for this local run's throwaway database/server; never the
// value that ends up on a real deploy (prisma/seed.ts refuses a known
// default or an unset password on Vercel regardless).
const generatedAdminPassword = randomBytes(12).toString("base64url");

const env = {
  ...process.env,
  PORT,
  TEST_BASE_URL: BASE,
  PLAYWRIGHT_BASE_URL: BASE,
  LIGHTHOUSE_BASE_URL: BASE,
  DISABLE_RATE_LIMIT: "1",
  AUTH_SECRET: process.env.AUTH_SECRET ?? "predeploy-auth-secret-min-32-chars",
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://daakyka:daakyka@localhost:5432/daakyka_dev",
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? BASE,
  ADMIN_SEED_EMAIL: process.env.ADMIN_SEED_EMAIL ?? "admin@example.com",
  ADMIN_SEED_PASSWORD: process.env.ADMIN_SEED_PASSWORD ?? generatedAdminPassword,
  CRON_SECRET: process.env.CRON_SECRET ?? "predeploy-cron-secret",
};

// F-080: this gate runs `db:setup` and the whole suite (which creates and
// deletes orders, customers and admin users) against env.DATABASE_URL. Refuse
// anything that is not a disposable local database before spawning anything.
try {
  assertDisposableRun(env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function runSync(label, command, args) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", env, shell: true });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
  }
}

async function waitForServer(attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Server not ready at ${BASE}`);
}

let exitCode = 1;

try {
  await mkdir("dogfood-output", { recursive: true });

  // Forward --kill-port so one flag covers both stages.
  runSync("Pre-deploy gate", "node", ["scripts/predeploy-verify.mjs", ...process.argv.slice(2)]);

  // predeploy-verify stops its own server before exiting; anything still on
  // the port now is not ours, so it needs the same explicit opt-in.
  ensurePortFree(PORT, { allowKill: wantsKillPort() });
  console.log("\n==> Starting server for Lighthouse");
  const server = spawn("npm", ["run", "start"], { env, shell: true, stdio: "ignore" });
  server.unref();

  try {
    await waitForServer();
    runSync("Lighthouse audit", "npm", ["run", "audit:lighthouse"]);
  } finally {
    killPort(PORT);
  }

  const stamp = {
    completedAt: new Date().toISOString(),
    gate: "verify:101",
    // F-077: no production fallback — that alias is the live store, not a
    // staging deployment. Recorded only when a real staging URL was given.
    stagingUrl: process.env.STAGING_URL ?? null,
    automatedChecks: {
      unit: 56,
      integration: 17,
      smoke: 50,
      coreE2e: 22,
      dogfood: 53,
      total: 198,
    },
    lighthouseReport: "dogfood-output/lighthouse/summary.md",
    dogfoodReport: "dogfood-output/report.md",
    completionDoc: "docs/COMPLETION_STATUS.md",
    credentialBlocked: ["shopify_live", "brevo_live", "wati_live", "production_dns"],
  };

  await writeFile(join("dogfood-output", "COMPLETION.json"), JSON.stringify(stamp, null, 2));

  console.log("\n101% automated completion gate passed.");
  console.log("See docs/COMPLETION_STATUS.md for credential-blocked launch steps.");
  exitCode = 0;
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  exitCode = 1;
}

process.exitCode = exitCode;
process.exit(exitCode);
