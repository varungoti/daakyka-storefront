/**
 * Wire staging AR try-on via local Docker + Cloudflare quick tunnel.
 * For production-stable hosting use Railway/Render — see docs/DEPLOY_AR_TRYON.md
 *
 * Prerequisites: Docker (ar-tryon), Vercel CLI logged in, cloudflared in bin/
 *
 * Usage:
 *   node scripts/wire-ar-staging.mjs
 *   node scripts/wire-ar-staging.mjs --no-deploy
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skipDeploy = process.argv.includes("--no-deploy");
const cloudflared = path.join(root, "bin", "cloudflared.exe");
const tunnelUrlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { cwd: root, shell: true, encoding: "utf8", ...opts });
  return result;
}

async function ensureDocker() {
  const ps = run("docker", ["ps", "--filter", "name=ar-tryon", "--format", "{{.Status}}"]);
  if (!ps.stdout?.includes("Up")) {
    console.log("Starting ar-tryon via docker compose…");
    const up = run("docker", ["compose", "up", "-d", "ar-tryon"]);
    if (up.status !== 0) {
      console.error(up.stderr || up.stdout);
      process.exit(1);
    }
  }
  const health = await fetch("http://localhost:8080/health").catch(() => null);
  if (!health?.ok) {
    console.error("AR service not healthy on http://localhost:8080");
    process.exit(1);
  }
  console.log("Local AR service healthy.");
}

async function ensureCloudflared() {
  if (existsSync(cloudflared)) return;
  await mkdir(path.dirname(cloudflared), { recursive: true });
  console.log("Downloading cloudflared…");
  const url =
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await import("node:fs/promises").then((fs) => fs.writeFile(cloudflared, buffer));
}

function startTunnel() {
  return new Promise((resolve, reject) => {
    const child = spawn(cloudflared, ["tunnel", "--url", "http://localhost:8080"], {
      cwd: root,
      shell: true,
    });
    const rl = createInterface({ input: child.stderr });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Tunnel URL timeout"));
    }, 60_000);

    rl.on("line", (line) => {
      const match = line.match(tunnelUrlPattern);
      if (match) {
        clearTimeout(timeout);
        resolve({ url: match[0], child });
      }
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) reject(new Error(`cloudflared exited ${code}`));
    });
  });
}

async function setVercelEnv(url) {
  const add = run("npx", ["vercel", "env", "add", "AR_TRYON_SERVICE_URL", "production"], {
    input: `${url}\n`,
  });
  if (add.status !== 0 && !add.stderr?.includes("already exists")) {
    console.error(add.stderr || add.stdout);
    process.exit(1);
  }
  console.log(`Vercel AR_TRYON_SERVICE_URL → ${url}`);
}

async function main() {
  console.log("\nDAAKYKA — Wire AR staging tunnel\n");
  await ensureDocker();
  await ensureCloudflared();

  console.log("Starting Cloudflare quick tunnel (keep this process running)…");
  const { url, child } = await startTunnel();
  console.log(`Tunnel: ${url}`);

  const remoteHealth = await fetch(`${url}/health`).catch(() => null);
  if (!remoteHealth?.ok) {
    child.kill();
    console.error("Tunnel health check failed");
    process.exit(1);
  }

  setVercelEnv(url);

  if (!skipDeploy) {
    console.log("Redeploying Vercel production…");
    const deploy = run("npx", ["vercel", "deploy", "--prod", "--yes"]);
    if (deploy.status !== 0) {
      console.error(deploy.stderr || deploy.stdout);
      process.exit(1);
    }
  }

  console.log("\nStaging AR wired. Keep this terminal open — tunnel stops when you exit.");
  console.log("For durable hosting: railway login && railway up (see docs/DEPLOY_AR_TRYON.md)\n");

  process.on("SIGINT", () => {
    child.kill();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
