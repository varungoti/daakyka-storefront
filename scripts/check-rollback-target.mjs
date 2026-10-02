/**
 * Guard for Vercel Instant Rollback (F-344): checks that a deployment you are
 * about to promote was built against the CURRENT production database.
 *
 * Why this exists: Vercel keeps, per deployment, the env vars it was built
 * with. Production moved from Neon to Supabase on 2026-09-22, so promoting
 * any older production deployment points the live store back at Neon. Orders,
 * customers and admin edits made since then vanish from the store, and new
 * orders are written to the wrong database. Every production build runs
 * `prisma migrate deploy`, which prints the database it migrated; this reads
 * that line out of the deployment's build log and refuses anything else.
 *
 * Read-only: it runs `vercel inspect <deployment> --logs` (or reads a saved
 * log) and prints a verdict. It never promotes, rolls back, deploys or writes.
 *
 * Usage (from the repo root, logged in to the Vercel CLI):
 *   node scripts/check-rollback-target.mjs <deployment-url-or-id>
 *   node scripts/check-rollback-target.mjs <deployment> --expect-host <db-host>
 *   node scripts/check-rollback-target.mjs --log-file <saved-build-log.txt>
 *
 * The production database host to compare against comes from, in order:
 * --expect-host, ROLLBACK_EXPECT_DB_HOST, or the host of MIGRATION_DATABASE_URL /
 * SUPABASE_DATABASE_URL (this shell's environment, then ./.env). Only the host
 * name is ever read out of those URLs or printed.
 *
 * Exit code: 0 = safe to roll back to, 1 = do NOT roll back to it (or it could
 * not be proven safe), 2 = bad usage.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { classifyRollbackTarget, databaseHostFromUrl } from "./lib/deploy-checks.mjs";
import { readEnvFile } from "./lib/read-env-file.mjs";

// A deployment id (dpl_...), a *.vercel.app hostname, or an https URL of one.
// Strict on purpose: the value is passed to a child process, and on Windows
// that child runs through a shell (npx is npx.cmd there).
const DEPLOYMENT_PATTERN = /^(https:\/\/)?[A-Za-z0-9][A-Za-z0-9._-]*(\/)?$/;

/**
 * Pure: parsed argv. `error` is a message when the arguments are unusable
 * (and the other fields are then not meaningful), otherwise null.
 *
 * @param {string[]} argv
 * @returns {{ target: string | null, logFile: string | null, expectHost: string | null, error: string | null }}
 */
export function parseArgs(argv) {
  const out = { target: null, logFile: null, expectHost: null, error: null };
  const fail = (/** @type {string} */ error) => ({ ...out, error });
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--expect-host" || arg === "--log-file") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) return fail(`${arg} needs a value.`);
      if (arg === "--expect-host") out.expectHost = value;
      else out.logFile = value;
      i += 1;
    } else if (arg.startsWith("--")) {
      return fail(`Unknown option ${arg}.`);
    } else if (out.target) {
      return fail("Only one deployment can be checked at a time.");
    } else {
      out.target = arg;
    }
  }
  if (!out.target && !out.logFile) return fail("Pass a deployment URL/id, or --log-file <path>.");
  if (out.target && out.logFile) return fail("Pass either a deployment or --log-file, not both.");
  if (out.target && !DEPLOYMENT_PATTERN.test(out.target)) {
    return fail(`"${out.target}" does not look like a Vercel deployment URL or id.`);
  }
  return out;
}

function expectedHostFromEnvironment() {
  const fromVar = process.env.ROLLBACK_EXPECT_DB_HOST?.trim();
  if (fromVar) return fromVar.toLowerCase();
  for (const key of ["MIGRATION_DATABASE_URL", "SUPABASE_DATABASE_URL"]) {
    const host = databaseHostFromUrl(process.env[key]);
    if (host) return host;
  }
  if (existsSync(".env")) {
    try {
      const file = readEnvFile(".env");
      for (const key of ["MIGRATION_DATABASE_URL", "SUPABASE_DATABASE_URL"]) {
        const host = databaseHostFromUrl(file.get(key));
        if (host) return host;
      }
    } catch {
      // An unreadable .env just means there is no host to compare against.
    }
  }
  return null;
}

function readBuildLog({ target, logFile }) {
  if (logFile) return readFileSync(logFile, "utf8");
  const result = spawnSync("npx", ["vercel", "inspect", target, "--logs"], {
    encoding: "utf8",
    // npx is npx.cmd on Windows, which only runs through a shell; `target`
    // was validated against DEPLOYMENT_PATTERN above.
    shell: process.platform === "win32",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `\`vercel inspect ${target} --logs\` failed (${result.error?.message ?? `exit ${result.status}`}). ` +
        "Check that the Vercel CLI is logged in and linked to the storefront project.",
    );
  }
  // The build log goes to stderr on some CLI versions and stdout on others.
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(`${args.error}\nUsage: node scripts/check-rollback-target.mjs <deployment> [--expect-host <db-host>]`);
    process.exit(2);
  }

  let log;
  try {
    log = readBuildLog(args);
  } catch (error) {
    console.error(`ABORTED: ${error.message}`);
    process.exit(1);
  }

  const expectedHost = args.expectHost?.toLowerCase() ?? expectedHostFromEnvironment();
  const verdict = classifyRollbackTarget(log, { expectedHost });

  console.log(`Rollback target: ${args.target ?? args.logFile}`);
  console.log(`Database host(s) in the build log: ${verdict.hosts.join(", ") || "none"}`);
  console.log(`Expected production database host: ${expectedHost ?? "not available"}`);

  if (!verdict.safe) {
    console.error(`\nDO NOT ROLL BACK TO THIS DEPLOYMENT: ${verdict.message}`);
    console.error("Pick a newer production deployment and check it the same way (docs/GO_LIVE_RUNBOOK.md, 'Rolling back a bad deploy').");
    process.exit(1);
  }
  if (!verdict.confirmed) {
    console.warn(
      `\nWARNING: ${verdict.message}\nRe-run with --expect-host <production database host> (or set ` +
        "SUPABASE_DATABASE_URL in this shell) to confirm it, before promoting.",
    );
    process.exit(1);
  }
  console.log(`\nOK: ${verdict.message}`);
  console.log(
    "This only checks the database. Also confirm the deployment is a recent production build that " +
      "already contains every migration applied to production (see the runbook).",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
