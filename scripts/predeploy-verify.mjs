/**
 * Pre-deploy gate: build + start server + smoke + E2E + dogfood.
 * Use before staging/production promotion.
 *
 * Usage: npm run verify:predeploy
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
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

function run(command, args, label) {
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

  // F-309: refuse to start over something else already listening on the port
  // (re-run with --kill-port / KILL_PORT=1 to let this script stop it).
  ensurePortFree(PORT, { allowKill: wantsKillPort() });

  run("npm", ["run", "db:setup"], "Database setup");
  run("npm", ["run", "verify"], "Lint, unit, integration, build");

  console.log("\n==> Starting production server");
  const server = spawn("npm", ["run", "start"], {
    env,
    shell: true,
    stdio: "ignore",
  });
  server.unref();

  try {
    await waitForServer();
    run("npm", ["run", "test:smoke"], "Smoke tests");
    run("npm", ["run", "test:e2e"], "Core E2E");
    run("npm", ["run", "test:dogfood"], "Dogfood E2E");
    console.log("\nPre-deploy verification passed.");
    exitCode = 0;
  } finally {
    // Stop the server this run started. Safe to do synchronously: only the
    // socket LISTENING on this exact port is killed (never this process or
    // its own client connections), and the port was verified free above.
    killPort(PORT);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  exitCode = 1;
}

process.exitCode = exitCode;
process.exit(exitCode);
