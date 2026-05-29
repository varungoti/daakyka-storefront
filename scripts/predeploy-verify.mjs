/**
 * Pre-deploy gate: build + start server + smoke + E2E + dogfood.
 * Use before staging/production promotion.
 *
 * Usage: npm run verify:predeploy
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import { mkdir } from "node:fs/promises";

const PORT = process.env.PORT ?? "3000";
const BASE = `http://localhost:${PORT}`;

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
  ADMIN_SEED_EMAIL: process.env.ADMIN_SEED_EMAIL ?? "varungoti@gmail.com",
  ADMIN_SEED_PASSWORD: process.env.ADMIN_SEED_PASSWORD ?? "Daakyka@2026",
  CRON_SECRET: process.env.CRON_SECRET ?? "predeploy-cron-secret",
};

function killPort(port) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const pids = new Set();
      for (const line of output.split("\n")) {
        const match = line.trim().match(/\s+(\d+)\s*$/);
        if (match && match[1] !== "0") pids.add(match[1]);
      }
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
        } catch {
          /* ignore */
        }
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: true });
    }
  } catch {
    /* port already free */
  }
}

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

  killPort(PORT);

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
    // Delay port cleanup so process.exit(0) is not overridden on Windows
    setTimeout(() => killPort(PORT), 500);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  exitCode = 1;
}

process.exitCode = exitCode;
process.exit(exitCode);
