/**
 * Generate staging secrets and either write them straight to Vercel's Preview
 * environment or print a template. Does not create cloud resources.
 *
 * F-309: this used to print the freshly generated AUTH_SECRET, CRON_SECRET and
 * ADMIN_SEED_PASSWORD to the terminal (and into its scrollback) every time it
 * ran, and hard-coded a personal email as the new store's admin. Now:
 *   - By default the generated secrets are NOT shown; the template lists the
 *     variable names and where each value will come from.
 *   - `--apply` pipes each secret to `vercel env add <name> preview --force`
 *     over stdin, so it goes from memory to Vercel's secret store without
 *     touching the terminal. It never targets Production.
 *   - `--reveal` (or `--json`) prints the values on purpose, for an operator
 *     who really needs to copy them somewhere else.
 *   - The admin email must be supplied (`--admin-email=you@example.com` or the
 *     ADMIN_SEED_EMAIL env var); there is no default person.
 *
 * Usage:
 *   npm run bootstrap:staging -- --admin-email=owner@example.com            # template only
 *   npm run bootstrap:staging -- --admin-email=owner@example.com --apply    # write to Vercel Preview
 *   npm run bootstrap:staging -- --admin-email=owner@example.com --reveal   # print the values
 *   npm run bootstrap:staging -- --admin-email=owner@example.com --json     # machine-readable, prints values
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

/** The only Vercel environment this script is allowed to write. */
export const TARGET = "preview";

/** Generated values that must never be printed unless explicitly asked for. */
export const SECRET_KEYS = ["AUTH_SECRET", "CRON_SECRET", "ADMIN_SEED_PASSWORD"];

const ADMIN_EMAIL_PLACEHOLDER = "YOUR-ADMIN-EMAIL";

/**
 * Pure: the admin email from `--admin-email=...` or the env, else null.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function readAdminEmail(argv, env) {
  const flag = argv.find((arg) => arg.startsWith("--admin-email="));
  const value = (flag ? flag.slice("--admin-email=".length) : env.ADMIN_SEED_EMAIL ?? "").trim();
  return value || null;
}

/**
 * Pure apart from the injected randomness: the staging variable set. Key order
 * is the order they are listed to the operator.
 * @param {{ adminEmail?: string | null, random?: (size: number) => Buffer }} [options]
 */
export function generateStagingEnv({ adminEmail, random = randomBytes } = {}) {
  return {
    DATABASE_URL: "postgresql://USER:PASSWORD@HOST:5432/daakyka_staging?sslmode=verify-full",
    AUTH_SECRET: random(32).toString("hex"),
    CRON_SECRET: random(24).toString("hex"),
    NEXT_PUBLIC_SITE_URL: "https://YOUR-PROJECT.vercel.app",
    NEXT_PUBLIC_ALLOW_INDEXING: "false",
    ADMIN_SEED_EMAIL: adminEmail ?? ADMIN_EMAIL_PLACEHOLDER,
    ADMIN_SEED_PASSWORD: `Dk@${random(4).toString("hex")}!${random(2).toString("hex").toUpperCase()}`,
  };
}

/**
 * Pure: `KEY=value` lines, with generated secrets masked unless `reveal`.
 * @param {Record<string, string>} env
 * @param {{ reveal?: boolean }} [options]
 */
export function renderEnvLines(env, { reveal = false } = {}) {
  return Object.entries(env).map(([key, value]) => {
    if (!reveal && SECRET_KEYS.includes(key)) {
      return `${key}=<generated, not shown - use --apply to send it to Vercel ${TARGET}, or --reveal to print it>`;
    }
    return `${key}=${value}`;
  });
}

/** Pure: argv for `npx vercel env add <name> preview --force` (never production). */
export function buildVercelEnvAddArgs(name) {
  return ["vercel", "env", "add", name, TARGET, "--force"];
}

/**
 * Variables `--apply` writes: the generated secrets plus the admin email.
 * @param {Record<string, string>} env
 * @param {string | null} [adminEmail]
 */
export function applyPlan(env, adminEmail) {
  const names = [...SECRET_KEYS, ...(adminEmail ? ["ADMIN_SEED_EMAIL"] : [])];
  return names.map((name) => ({ name, value: env[name] }));
}

function pushToVercel(plan) {
  let failed = 0;
  for (const { name, value } of plan) {
    // shell:true only because `npx` is npx.cmd on Windows. The arguments are
    // constants and the value travels over stdin, so no secret ever appears
    // in a command line, and none is echoed here.
    const result = spawnSync("npx", buildVercelEnvAddArgs(name), {
      input: value,
      encoding: "utf8",
      stdio: ["pipe", "ignore", "pipe"],
      shell: true,
    });
    const ok = result.status === 0;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
    if (!ok && result.stderr) {
      console.log(`        ${String(result.stderr).trim().split("\n").slice(-2).join(" ")}`);
    }
  }
  return failed;
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const apply = argv.includes("--apply");
  const reveal = argv.includes("--reveal") || asJson;
  const adminEmail = readAdminEmail(argv, process.env);

  if (apply && !adminEmail) {
    console.error("--apply needs --admin-email=<address> (or ADMIN_SEED_EMAIL): the staging store's first admin.");
    process.exit(1);
  }

  const env = generateStagingEnv({ adminEmail });

  if (asJson) {
    console.log(JSON.stringify(env, null, 2));
    process.exit(0);
  }

  console.log("\nDAAKYKA Staging Bootstrap\n");

  if (apply) {
    console.log(`Writing generated secrets to Vercel ${TARGET} (values are not printed):\n`);
    const failed = pushToVercel(applyPlan(env, adminEmail));
    if (failed > 0) {
      console.error(`\n${failed} variable(s) failed - see above. Every entry uses --force, so re-running overwrites cleanly.`);
      process.exit(1);
    }
    console.log(
      "\nDone. Still to set by hand: DATABASE_URL and NEXT_PUBLIC_SITE_URL (see the template below).\n",
    );
  }

  console.log("1. Create a staging Postgres database (a separate Supabase project, Neon, etc.) -> DATABASE_URL");
  console.log("2. Import the repo to Vercel (Root Directory = `.`)");
  console.log(`3. Environment variables for the ${TARGET} environment:\n`);

  for (const line of renderEnvLines(env, { reveal })) {
    console.log(line);
  }

  if (!adminEmail) {
    console.log(`\n   (ADMIN_SEED_EMAIL is a placeholder - pass --admin-email=<address> to set it)`);
  }

  console.log("\n4. Deploy the staging branch, then:\n");
  console.log("   npm run go-live:check");
  console.log("   TEST_BASE_URL=https://YOUR-PROJECT.vercel.app npm run probe:deploy -- --staging");
  console.log("   TEST_BASE_URL=https://YOUR-PROJECT.vercel.app npm run verify:staging -- --dogfood");
  console.log("\n5. Change the admin password after first login.\n");
  console.log("Full guide: docs/GO_LIVE_RUNBOOK.md\n");
}

// Only run when executed directly, not when a test imports the helpers.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
