/** Run the GitHub-independent, disposable Docker verification gate. */
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";

function command(program, args, options = {}) {
  const result = spawnSync(program, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed (${result.status})`);
}

const sha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
if (sha.status !== 0) throw new Error("Cannot identify the source revision");
const sourceSha = sha.stdout.trim();
const browserOnly = process.argv.includes("--browser-only");
const project = `daakyka-local-ci-${process.pid}`;
const args = ["compose", "-f", "compose.local-ci.yml", "-p", project];
const env = { ...process.env, CI_SOURCE_SHA: sourceSha };
mkdirSync("dogfood-output/local-ci", { recursive: true });

async function runWithLog() {
  const log = createWriteStream("dogfood-output/local-ci/run.log");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("docker", [
        ...args, "run", "--build", "--rm", "verify",
        ...(browserOnly ? ["node", "scripts/local-ci-runner.mjs", "--browser-only"] : []),
      ], {
        env,
        stdio: ["inherit", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      child.stdout.on("data", (chunk) => { process.stdout.write(chunk); log.write(chunk); });
      child.stderr.on("data", (chunk) => { process.stderr.write(chunk); log.write(chunk); });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Docker CI failed (${code})`)));
    });
  } finally {
    await new Promise((resolve) => log.end(resolve));
  }
}

try {
  await runWithLog();
  const report = JSON.parse(readFileSync("dogfood-output/local-ci/report.json", "utf8"));
  if (!report.ok || report.sourceSha !== sourceSha || report.mode !== (browserOnly ? "browser-only" : "full")) {
    throw new Error("Docker CI report does not confirm the tested source revision");
  }
  console.log(`${browserOnly ? "Docker browser gate" : "Docker CI"} passed for ${sourceSha}`);
} finally {
  command("docker", [...args, "down"], { env });
}
