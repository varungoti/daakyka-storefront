/**
 * Wire a PREVIEW (staging) AR try-on through the local Docker service and a
 * Cloudflare quick tunnel. For production-stable hosting use Railway/Render —
 * see docs/DEPLOY_AR_TRYON.md.
 *
 * F-304 hardening — what this script will and will not do:
 *   - It only ever writes Vercel's PREVIEW environment. It never touches
 *     Production env and never runs `vercel deploy --prod`.
 *   - It refuses to open a tunnel unless AR_TRYON_API_KEY is set, recreates
 *     the local container WITH that key, and checks that an unauthenticated
 *     request to the service is rejected before and after exposing it. A
 *     public quick-tunnel URL on an unauthenticated service lets anyone burn
 *     this machine's compute.
 *   - It does not download anything. cloudflared must already be installed
 *     and on PATH; the old behaviour of fetching an unpinned, unverified
 *     `releases/latest` binary and running it is gone.
 *   - Nothing is spawned through a shell except `npx` (needed for npx.cmd on
 *     Windows) with constant arguments; secrets travel over stdin or the
 *     child's env, never in argv, and are never printed.
 *   - A failing `vercel env add` aborts the script. It uses `--force`
 *     (Vercel's upsert) so an existing value is replaced, instead of treating
 *     "already exists" as success while Vercel keeps the stale tunnel URL.
 *   - Redeploying is opt-in (`--deploy`) and only creates a preview deployment.
 *     A deploy triggers a remote, metered Vercel build.
 *
 * Prerequisites: Docker, the Vercel CLI logged in and linked, cloudflared
 * installed, and AR_TRYON_API_KEY exported in this shell (generate one with
 * `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
 *
 * Usage:
 *   AR_TRYON_API_KEY=... node scripts/wire-ar-staging.mjs
 *   AR_TRYON_API_KEY=... node scripts/wire-ar-staging.mjs --deploy
 */
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The only Vercel environment this script is allowed to write. */
export const TARGET = "preview";

export const MIN_API_KEY_LENGTH = 24;

const TUNNEL_URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const LOCAL_AR_URL = "http://127.0.0.1:8080";

/** Pure: the first quick-tunnel URL in a line of cloudflared output, or null. */
export function parseTunnelUrl(line) {
  return line.match(TUNNEL_URL_PATTERN)?.[0] ?? null;
}

/**
 * Pure: argv for `npx vercel env add <name> preview --force`. Exported so a
 * test can assert this script can never be pointed at Production.
 */
export function buildVercelEnvAddArgs(name) {
  return ["vercel", "env", "add", name, TARGET, "--force"];
}

/** Pure: argv for the opt-in preview deployment (no `--prod`, ever). */
export function buildVercelDeployArgs() {
  return ["vercel", "deploy", "--yes"];
}

/** Pure: why `key` can't be used, or null when it is acceptable. */
export function apiKeyProblem(key) {
  if (!key) return "AR_TRYON_API_KEY is not set in this shell.";
  if (key.length < MIN_API_KEY_LENGTH) {
    return `AR_TRYON_API_KEY is too short (${key.length} chars, needs >= ${MIN_API_KEY_LENGTH}).`;
  }
  return null;
}

function fail(message) {
  console.error(`\nABORTED: ${message}`);
  process.exit(1);
}

// Only a cloudflared the operator installed themselves (on PATH) is used. A
// binary lying around under bin/ is deliberately NOT picked up: older versions
// of this script downloaded one from an unpinned URL with no checksum.
function resolveCloudflared() {
  const probe = spawnSync("cloudflared", ["--version"], { encoding: "utf8" });
  if (probe.status === 0) return "cloudflared";
  fail(
    "cloudflared is not installed. Install it yourself from Cloudflare's official downloads " +
      "(https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) " +
      "and make sure `cloudflared --version` works in this shell. This script no longer " +
      "downloads one for you, and ignores any old bin/cloudflared.exe.",
  );
}

function recreateLocalContainer() {
  console.log("Recreating ar-tryon with AR_TRYON_API_KEY (docker compose up --force-recreate)...");
  // The key reaches compose through this process's environment
  // (docker-compose.yml: AR_TRYON_API_KEY: ${AR_TRYON_API_KEY:-}).
  const up = spawnSync("docker", ["compose", "up", "-d", "--force-recreate", "ar-tryon"], {
    cwd: root,
    stdio: "inherit",
  });
  if (up.status !== 0) fail("docker compose could not start the ar-tryon service.");
}

async function waitForHealth(baseUrl, attempts = 45) {
  for (let i = 0; i < attempts; i += 1) {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5_000) }).catch(() => null);
    if (response?.ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return false;
}

/** True when the service answers an unauthenticated /predict with 401. */
async function rejectsUnauthenticated(baseUrl) {
  const response = await fetch(`${baseUrl}/predict`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ top_garment_url: "https://images.pexels.com/photos/4173251/pexels-photo-4173251.jpeg" }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  return response?.status === 401;
}

function startTunnel(cloudflared) {
  return new Promise((resolve, reject) => {
    const child = spawn(cloudflared, ["tunnel", "--url", LOCAL_AR_URL], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const rl = createInterface({ input: child.stderr });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Tunnel URL timeout"));
    }, 60_000);

    rl.on("line", (line) => {
      const url = parseTunnelUrl(line);
      if (url) {
        clearTimeout(timeout);
        resolve({ url, child });
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`cloudflared exited ${code}`));
    });
  });
}

function setVercelEnv(name, value) {
  // shell:true only because `npx` is npx.cmd on Windows; the arguments are
  // constants and the value goes over stdin, so nothing user-controlled is
  // ever interpolated into a command line.
  const result = spawnSync("npx", buildVercelEnvAddArgs(name), {
    cwd: root,
    input: value,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "pipe"],
    shell: true,
  });
  if (result.status !== 0) {
    // stderr from `vercel env add` names the variable, not its value.
    fail(`could not set ${name} on Vercel ${TARGET}: ${String(result.stderr ?? "").trim().split("\n").slice(-2).join(" ")}`);
  }
  console.log(`  ok  ${name} -> Vercel ${TARGET}`);
}

async function main() {
  const deployPreview = process.argv.includes("--deploy");
  const apiKey = process.env.AR_TRYON_API_KEY;

  console.log(`\nDAAKYKA — wire AR try-on tunnel to Vercel ${TARGET}\n`);

  const keyProblem = apiKeyProblem(apiKey);
  if (keyProblem) {
    fail(
      `${keyProblem} Refusing to expose the local AR service to the internet without it. ` +
        "Generate a key, export it, and re-run.",
    );
  }

  const cloudflared = resolveCloudflared();

  recreateLocalContainer();
  if (!(await waitForHealth(LOCAL_AR_URL))) fail(`AR service not healthy on ${LOCAL_AR_URL}.`);
  if (!(await rejectsUnauthenticated(LOCAL_AR_URL))) {
    fail("the local AR service accepted an unauthenticated /predict request; not opening a tunnel.");
  }
  console.log("Local AR service healthy and requires its API key.");

  console.log("Starting Cloudflare quick tunnel (keep this process running)...");
  const { url, child } = await startTunnel(cloudflared);
  console.log(`Tunnel: ${url}`);

  let tunnelOk = false;
  try {
    const remoteHealth = await fetch(`${url}/health`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    tunnelOk = Boolean(remoteHealth?.ok) && (await rejectsUnauthenticated(url));
  } finally {
    if (!tunnelOk) child.kill();
  }
  if (!tunnelOk) fail("tunnel health/authentication check failed.");

  setVercelEnv("AR_TRYON_SERVICE_URL", url);
  setVercelEnv("AR_TRYON_API_KEY", apiKey);

  if (!deployPreview) {
    console.log(
      "\nPreview env updated. It only applies to NEW preview deployments: redeploy one yourself, or re-run with --deploy " +
        "(creates a preview deployment, which is a metered Vercel build). Production was not touched.",
    );
  } else {
    console.log("\nCreating a preview deployment (not production)...");
    const deploy = spawnSync("npx", buildVercelDeployArgs(), {
      cwd: root,
      stdio: "inherit",
      shell: true,
    });
    if (deploy.status !== 0) {
      child.kill();
      fail("vercel deploy failed - see above.");
    }
  }

  console.log("\nKeep this terminal open: the tunnel stops when you exit.");
  console.log("For durable hosting use Railway/Render (docs/DEPLOY_AR_TRYON.md).\n");

  process.on("SIGINT", () => {
    child.kill();
    process.exit(0);
  });
}

// Only run when executed directly, not when a test imports the helpers.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
