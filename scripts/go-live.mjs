/**
 * One-command production go-live.
 *
 * Runs, in this order:
 *   1. preflight   — validate what's in .env, and what computePlan() would
 *                    push, before anything leaves the machine
 *   2. migrate     — apply pending migrations directly against the
 *                    Supabase database, proving it actually connects
 *   3. env         — push the local values to Vercel under their PRODUCTION names
 *   4. deploy      — vercel --prod
 *   5. smoke       — fetch the deployed site and run the checks below
 *
 * Step 2 is not what makes deploying new code against old tables safe —
 * scripts/vercel-build.mjs's build step re-runs `prisma migrate deploy`
 * itself before `next build` on every real production deploy, so a bare
 * `vercel --prod` with no separate migrate step here would already apply
 * migrations before the new code goes live, in the same safe order. Step 2
 * exists to fail fast and locally instead: a broken migration (or a
 * DATABASE_URL that doesn't actually connect — see F-352) shows up here,
 * with a plain exit code and a recovery hint, before Vercel env has been
 * touched or a deploy has even been attempted — not buried in a remote
 * Vercel build log after both already happened.
 *
 * Usage:
 *   node scripts/go-live.mjs                    # dry run — shows the plan, changes nothing
 *   node scripts/go-live.mjs --yes               # actually go live
 *   node scripts/go-live.mjs --yes --skip-env    # env already correct on Vercel
 *   node scripts/go-live.mjs --yes --skip-migrate
 *   node scripts/go-live.mjs --yes --allow-noindex   # deliberate soft launch — see below
 *
 * --allow-noindex acknowledges a deliberate soft launch: it turns the
 * smoke stage's noindex/robots-disallow checks (and the preflight check
 * for a leftover NEXT_PUBLIC_ALLOW_INDEXING on Vercel) from a hard abort
 * into a loud warning. It does not set, remove, or push that variable
 * itself — see push-env-to-vercel.mjs's MAPPING comment for why not.
 *
 * See docs/GO_LIVE_RUNBOOK.md's "Go-live with scripts/go-live.mjs" section
 * for the full flag reference and what this script does NOT set.
 *
 * Secrets are passed to child processes via stdin or the child's env and are
 * never printed, logged, or written to disk by this script.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readEnvFile } from "./lib/read-env-file.mjs";
import { computePlan, TARGET } from "./push-env-to-vercel.mjs";
import {
  homepageHasNoindexMeta,
  extractCanonicalHref,
  isLikelyProtectedVercelAlias,
  isRedirectStatus,
  isSsoRedirectLocation,
  pickProductionHostname,
  robotsTxtBlocksAll,
  robotsTxtHasSitemap,
  vercelIgnoreCoversEnvSecrets,
} from "./lib/deploy-checks.mjs";

const APPLY = process.argv.includes("--yes");
const SKIP_ENV = process.argv.includes("--skip-env");
const SKIP_MIGRATE = process.argv.includes("--skip-migrate");
// F-349/F-354: acknowledges a deliberate soft launch — see the header
// comment above and each call site below for exactly what this silences.
const ALLOW_NOINDEX = process.argv.includes("--allow-noindex");

let env;
try {
  env = readEnvFile(".env");
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

let step = 0;
function stage(name) {
  step += 1;
  console.log(`\n${"=".repeat(64)}\n  ${step}. ${name}\n${"=".repeat(64)}`);
}

// F-353: die() used to just print the one failing message — an operator
// picking up a failed run had no way to tell, from the script's own
// output, whether Vercel env or the production database had already been
// changed before the failure, or whether it was safe to just re-run.
const completedStages = [];

function die(message) {
  console.error(`\nABORTED: ${message}`);
  if (completedStages.length > 0) {
    console.error(`\nAlready done before this failure: ${completedStages.join("; ")}.`);
  }
  if (completedStages.includes("deployed to Vercel production")) {
    console.error(
      "The new code is already live. If it's broken for real users, roll back with " +
        "`npx vercel rollback` to return to the previous production deployment while you investigate.",
    );
  }
  process.exit(1);
}

// ---------------------------------------------------------------- preflight
stage("Preflight");

const supabaseUrl = env.get("SUPABASE_DATABASE_URL");
if (!supabaseUrl) {
  die(
    "SUPABASE_DATABASE_URL is missing from .env.\n" +
      "It holds the production Supabase session-pooler string. If .env only has\n" +
      "DATABASE_URL pointing at Supabase, rename it back to SUPABASE_DATABASE_URL\n" +
      "and restore the local Postgres URL under DATABASE_URL — otherwise every\n" +
      "test run in this repo writes to production.",
  );
}

const ALLOW_NON_POOLER_DB = process.argv.includes("--allow-non-pooler-db");

let supabaseParsed;
try {
  supabaseParsed = new URL(supabaseUrl);
} catch {
  die(
    "SUPABASE_DATABASE_URL is not a parseable URL. If the password contains special characters " +
      "(@ # % / etc.), percent-encode them — see docs/GO_LIVE_RUNBOOK.md Phase B.",
  );
}
const supabaseHost = supabaseParsed.hostname;
if (supabaseHost.includes("localhost")) {
  die("SUPABASE_DATABASE_URL points at localhost — that is not the production database.");
}
// F-352: the direct host and the transaction pooler are both IPv6-only —
// unreachable from Vercel's runtime — so a URL that isn't the session
// pooler on port 5432 looks "fine" (parses, isn't localhost) right up
// until the actual production deploy can't connect. Every Supabase
// project in a region shares the same pooler *hostname*
// (aws-<n>-<region>.pooler.supabase.com), so the hostname alone can't
// even tell one project's database from another's — see the DATABASE_URL
// comparison below, which no longer relies on it either.
if (!ALLOW_NON_POOLER_DB) {
  if (!/^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(supabaseHost)) {
    die(
      `SUPABASE_DATABASE_URL's host (${supabaseHost}) doesn't look like a Supabase session-pooler ` +
        "host (aws-<n>-<region>.pooler.supabase.com). The direct host and the transaction pooler " +
        "are both IPv6-only, which Vercel's runtime can't reach — see docs/GO_LIVE_RUNBOOK.md Phase " +
        "B. Re-run with --allow-non-pooler-db if this is deliberate (e.g. a different provider).",
    );
  }
  const supabasePort = supabaseParsed.port || "5432";
  if (supabasePort !== "5432") {
    die(
      `SUPABASE_DATABASE_URL uses port ${supabasePort}, but the session pooler is always port 5432 ` +
        "— 6543 is the transaction pooler (IPv6-only, unreachable from Vercel's runtime). Re-run " +
        "with --allow-non-pooler-db if this is deliberate.",
    );
  }
}

const localUrl = env.get("DATABASE_URL");
if (localUrl) {
  let localParsed;
  try {
    localParsed = new URL(localUrl);
  } catch {
    die(
      "DATABASE_URL is not a parseable URL. If the password contains special characters " +
        "(@ # % / etc.), percent-encode them.",
    );
  }
  // F-352: compare user + host + port + database, not just hostname — a
  // different database on the SAME shared pooler hostname (a separate
  // staging Supabase project, say) is not "production" just because the
  // host matches, and a hostname-only check can't tell them apart at all.
  const samePort = (localParsed.port || "5432") === (supabaseParsed.port || "5432");
  const sameTarget =
    localParsed.hostname === supabaseParsed.hostname &&
    samePort &&
    localParsed.username === supabaseParsed.username &&
    localParsed.pathname === supabaseParsed.pathname;
  if (sameTarget) {
    die(
      "DATABASE_URL and SUPABASE_DATABASE_URL both point at the same production database.\n" +
        "Restore DATABASE_URL to the local Postgres before going live, or the next\n" +
        "`npm test` in this repo will run against live customer data.",
    );
  }
  console.log(`  DATABASE_URL (local tests)   -> ${localParsed.hostname}`);
}
console.log(`  SUPABASE_DATABASE_URL (prod) -> ${supabaseHost}`);

const seedPassword = env.get("ADMIN_SEED_PASSWORD");
if (!seedPassword) die("ADMIN_SEED_PASSWORD is missing from .env.");
if (seedPassword.length < 12) {
  die(
    `ADMIN_SEED_PASSWORD parses to ${seedPassword.length} characters, but production ` +
      `requires at least 12.\nIf it contains a '#', wrap the value in double quotes — ` +
      `unquoted, dotenv treats '#' as the start of a comment and truncates it.`,
  );
}
console.log(`  ADMIN_SEED_PASSWORD          -> ${seedPassword.length} chars, ok`);

const encryptionKey = env.get("CREDENTIAL_ENCRYPTION_KEY");
if (!encryptionKey) die("CREDENTIAL_ENCRYPTION_KEY is missing from .env.");
const keyBytes = /^[0-9a-fA-F]{64}$/.test(encryptionKey)
  ? Buffer.from(encryptionKey, "hex").length
  : Buffer.from(encryptionKey, "base64").length;
if (keyBytes !== 32) die(`CREDENTIAL_ENCRYPTION_KEY decodes to ${keyBytes} bytes, needs 32.`);
console.log(`  CREDENTIAL_ENCRYPTION_KEY    -> 32 bytes, ok`);

// F-349: these two are hard-required in production (src/lib/env.ts's
// validateEnv()) but nothing before this script's own smoke stage ever
// checked either one — a go-live could complete "successfully" and only
// fail at the next cold start, or leave every /api/cron/* route either
// unreachable or unprotected.
const authSecret = env.get("AUTH_SECRET");
if (!authSecret) die("AUTH_SECRET is missing from .env.");
if (authSecret.length < 32) {
  die(`AUTH_SECRET parses to ${authSecret.length} characters, but production requires at least 32.`);
}
console.log(`  AUTH_SECRET                  -> ${authSecret.length} chars, ok`);

const cronSecret = env.get("CRON_SECRET");
if (!cronSecret) die("CRON_SECRET is missing from .env — required to protect /api/cron/*.");
console.log("  CRON_SECRET                  -> set, ok");

// F-228 fix: this script deploys with `npx vercel --prod` below, which
// uploads the working tree as-is. The Vercel CLI does not read .gitignore
// — only .vercelignore/.nowignore, and its own default ignore list only
// covers .env.local/.env.*.local — so without a .vercelignore that also
// excludes .env, every CLI deploy uploaded this exact .env (production DB
// URL, API keys, everything checked above) straight into the deployment's
// source. Refuse to even reach the deploy stage until that's fixed.
let vercelIgnoreText;
try {
  vercelIgnoreText = readFileSync(".vercelignore", "utf8");
} catch {
  die(
    ".vercelignore is missing. The Vercel CLI does not read .gitignore, so `vercel --prod` " +
      "would upload .env (production secrets) into the deployment source. Add a .vercelignore " +
      "that excludes .env/.env.* (keeping !.env*.example) — see F-228.",
  );
}
if (!vercelIgnoreCoversEnvSecrets(vercelIgnoreText)) {
  die(
    ".vercelignore does not fully exclude the .env family, or wrongly excludes the " +
      ".env*.example templates — fix it before going live. See F-228.",
  );
}
console.log(`  .vercelignore                -> covers .env*, ok`);

// F-346: run the exact same mapping + validation push-env-to-vercel.mjs
// itself uses, and fail closed here — before ANY write — if it finds a
// problem. Previously the dry run above never called this at all, so a
// `.env` that would abort halfway through `--yes` (leaving Vercel
// half-written, see F-345) looked perfectly fine in the dry run.
const { plan: envPlan, problems: envProblems } = computePlan(env);
if (envProblems.length > 0) {
  die(
    `${envProblems.length} problem(s) with the values that would be pushed to Vercel — fix these ` +
      "first (nothing has been written):\n" +
      envProblems.map((problem) => `  - ${problem}`).join("\n"),
  );
}

if (!APPLY) {
  console.log(
    "\nDry run — nothing was changed.\n\n" +
      "Would then:\n" +
      `  2. apply pending Prisma migrations to ${supabaseHost}\n` +
      `  3. push ${envPlan.map((item) => item.prod).join(", ")}\n` +
      "     to Vercel production\n" +
      "  4. npx vercel --prod\n" +
      "  5. smoke-check the deployed site\n\n" +
      "Re-run with --yes to go live.",
  );
  process.exit(0);
}

// ------------------------------------------------------------------ migrate
if (SKIP_MIGRATE) {
  stage("Database migrations (skipped)");
} else {
  stage(`Database migrations -> ${supabaseHost}`);
  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    // Override only for this child. The parent's .env-backed DATABASE_URL,
    // which points at the local test database, is left untouched.
    env: { ...process.env, DATABASE_URL: supabaseUrl },
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    die(
      "migrations failed — production was NOT deployed.\n" +
        '  If this is P3009 ("migrate found failed migrations"), inspect it first:\n' +
        '    DATABASE_URL="$SUPABASE_DATABASE_URL" npx prisma migrate status\n' +
        "  then resolve the named migration — `npx prisma migrate resolve --rolled-back <name>` if " +
        "you rolled\n" +
        "  back its SQL by hand, or `--applied <name>` if it actually succeeded — and re-run this " +
        "script.\n" +
        "  See https://pris.ly/d/migrate-resolve.",
    );
  }
  completedStages.push(`migrations applied to ${supabaseHost}`);
}

// ---------------------------------------------------------------------- env
if (SKIP_ENV) {
  stage("Vercel environment variables (skipped)");
} else {
  stage("Vercel environment variables");

  // F-349: NEXT_PUBLIC_ALLOW_INDEXING is a deliberate, operator-set kill
  // switch (src/lib/env.ts's isIndexingAllowed) that this script must
  // never push, remove, or otherwise manage itself (see the MAPPING
  // comment in push-env-to-vercel.mjs) — but a copy left on Production
  // from an earlier soft launch silently blocks all search indexing, and
  // nothing before the smoke stage at the very end ever checked for one.
  // Check now, before pushing anything, so a launch can't complete on
  // autopilot with indexing quietly off.
  const existingEnv = spawnSync("npx", ["vercel", "env", "ls", TARGET], {
    encoding: "utf8",
    shell: true,
  });
  if (existingEnv.status === 0 && /NEXT_PUBLIC_ALLOW_INDEXING/.test(existingEnv.stdout ?? "")) {
    const message =
      `NEXT_PUBLIC_ALLOW_INDEXING is already set on Vercel ${TARGET}. If this is a deliberate soft ` +
      "launch, re-run with --allow-noindex (this only silences this check — it does not remove the " +
      `variable). Otherwise remove it now: \`npx vercel env rm NEXT_PUBLIC_ALLOW_INDEXING ${TARGET} ` +
      "--yes` — then re-run go-live.";
    if (ALLOW_NOINDEX) console.log(`  WARNING: ${message}`);
    else die(message);
  }

  const result = spawnSync(process.execPath, ["scripts/push-env-to-vercel.mjs", "--apply"], {
    stdio: "inherit",
  });
  if (result.status !== 0) die("pushing environment variables failed — see above.");
  completedStages.push("Vercel env vars pushed");
}

// ------------------------------------------------------------------- deploy
stage("Deploy to Vercel production");
// F-353: the previous `encoding: "utf8"` capture with no `stdio` override
// buffered BOTH streams until the CLI exited — for the 2-3 minutes a real
// build takes, this stage printed nothing at all. Piping only stdout
// (where the CLI prints its final deployment URL) while inheriting stderr
// (where its build-progress logs go) streams that progress live without
// losing the URL this script still needs to parse below.
const deploy = spawnSync("npx", ["vercel", "--prod", "--yes"], {
  encoding: "utf8",
  shell: true,
  stdio: ["ignore", "pipe", "inherit"],
});
process.stdout.write(deploy.stdout ?? "");
if (deploy.status !== 0) die("vercel --prod failed — see above.");
completedStages.push("deployed to Vercel production");

const uniqueDeployUrl = (deploy.stdout ?? "").match(/https:\/\/\S+\.vercel\.app\S*/g)?.at(-1)?.trim() ?? null;

// -------------------------------------------------------------------- smoke
stage("Smoke check");

// F-354: resolve the URL to test via `vercel inspect --format=json`
// (preferring a custom domain, then the public alias — see
// pickProductionHostname), instead of just re-using whatever unique
// deployment URL `vercel --prod` printed. That URL is always the
// project's own public `<project>-<hash>.vercel.app` alias, never the
// custom domain visitors and Razorpay's webhook actually use.
let deployedUrl = null;
if (uniqueDeployUrl) {
  const inspect = spawnSync("npx", ["vercel", "inspect", uniqueDeployUrl, "--format=json"], {
    encoding: "utf8",
    shell: true,
  });
  if (inspect.status === 0 && inspect.stdout) {
    try {
      const hostname = pickProductionHostname(JSON.parse(inspect.stdout));
      if (hostname) deployedUrl = `https://${hostname}`;
    } catch {
      // Unparseable/unexpected `vercel inspect` output — fall through to
      // the other sources below rather than aborting a deploy that has
      // already succeeded over a smoke-check convenience.
    }
  }
}
if (!deployedUrl) {
  const siteUrl = env.get("NEXT_PUBLIC_SITE_URL");
  if (siteUrl && !isLikelyProtectedVercelAlias(siteUrl)) deployedUrl = siteUrl;
}
if (!deployedUrl) deployedUrl = uniqueDeployUrl;

if (!deployedUrl) {
  // F-353: this used to print a message and exit 0 — a launch this script
  // itself could not verify was reported as a success.
  die(
    "could not determine the deployment URL to smoke-check. The deploy above may still have " +
      "succeeded — verify manually in the Vercel dashboard.",
  );
}
if (isLikelyProtectedVercelAlias(deployedUrl)) {
  console.log(
    `  WARNING: resolved URL ${deployedUrl} looks like an SSO-protected Vercel alias — the checks ` +
      "below will likely fail on a redirect.",
  );
}

async function fetchNoRedirect(url) {
  return fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
}

function dieOnRedirect(response, context) {
  if (!isRedirectStatus(response.status)) return;
  const location = response.headers.get("location");
  if (isSsoRedirectLocation(location)) {
    die(
      `${context} redirected (${response.status}) to ${location} — this looks like Vercel ` +
        "Deployment Protection (SSO) on the resolved host, not the app. Customers and crawlers " +
        "would hit a login page. Disable it for this environment in Vercel Project Settings → " +
        "Deployment Protection, or resolve to a host that doesn't have it.",
    );
  }
  die(`${context} redirected (${response.status}) to ${location ?? "(no Location header)"}.`);
}

// F-354: check /api/health — which actually touches the database
// (src/app/api/health/route.ts) — instead of only the static, prerendered
// `/`, which answers 200 even when the DB or env is broken.
console.log(`  GET ${deployedUrl}/api/health`);
try {
  const healthResponse = await fetchNoRedirect(`${deployedUrl}/api/health`);
  dieOnRedirect(healthResponse, "/api/health");
  if (healthResponse.status !== 200) {
    die(`/api/health answered ${healthResponse.status} — the deployment is up but unhealthy.`);
  }
  const healthBody = await healthResponse.json().catch(() => null);
  if (healthBody?.status !== "ok") {
    die(`/api/health returned ${JSON.stringify(healthBody)}, expected {"status":"ok"}.`);
  }
  console.log(`  -> 200 OK, status: ${healthBody.status}`);
} catch (error) {
  die(`could not reach ${deployedUrl}/api/health: ${error.message}`);
}

console.log(`  GET ${deployedUrl}`);
let homepageHtml = "";
try {
  const response = await fetchNoRedirect(deployedUrl);
  dieOnRedirect(response, "the homepage");
  homepageHtml = await response.text();
  console.log(`  -> ${response.status} ${response.statusText}, ${homepageHtml.length} bytes`);
  if (response.status !== 200) die(`the deployed site answered ${response.status}.`);
  // F-309: this used to only warn. A 200 that isn't this store's homepage
  // (a Vercel login page, a generic error shell, another project's site) must
  // not be reported as "Live".
  if (!/DAAKYKA/i.test(homepageHtml)) {
    die(
      `the homepage at ${deployedUrl} answered 200 but does not contain "DAAKYKA" — this is not the ` +
        "store's own page (a Vercel login/protection page or an error shell, most likely). Check the " +
        "resolved URL and the deployment in the Vercel dashboard before announcing a launch.",
    );
  }
} catch (error) {
  die(`could not reach the deployed site: ${error.message}`);
}

// F-054/F-349 fix: a bare 200 + a text match (above) would not have caught
// the leftover NEXT_PUBLIC_ALLOW_INDEXING=false that silently blocked all
// search indexing. NEXT_PUBLIC_ALLOW_INDEXING is a legitimate soft-launch
// switch (src/lib/env.ts's isIndexingAllowed), so this only warns when the
// operator has explicitly acknowledged that with --allow-noindex — an
// un-acknowledged noindex now aborts instead of reporting a silent success.
if (homepageHasNoindexMeta(homepageHtml)) {
  const message =
    'the deployed homepage has <meta name="robots" content="noindex...">. If this is a deliberate ' +
    "soft launch, re-run with --allow-noindex; otherwise remove NEXT_PUBLIC_ALLOW_INDEXING from " +
    "the Vercel Production env and redeploy — see F-054.";
  if (ALLOW_NOINDEX) console.log(`  WARNING: ${message}`);
  else die(message);
}

console.log(`  GET ${deployedUrl}/robots.txt`);
try {
  const robotsResponse = await fetchNoRedirect(`${deployedUrl}/robots.txt`);
  const robotsBody = await robotsResponse.text();
  if (robotsTxtBlocksAll(robotsBody)) {
    const message =
      'robots.txt disallows the whole site ("Disallow: /" with no Allow rule). If this is a ' +
      "deliberate soft launch, re-run with --allow-noindex; otherwise remove " +
      "NEXT_PUBLIC_ALLOW_INDEXING from the Vercel Production env and redeploy — see F-054.";
    if (ALLOW_NOINDEX) console.log(`  WARNING: ${message}`);
    else die(message);
  } else if (!robotsTxtHasSitemap(robotsBody)) {
    console.log("  WARNING: robots.txt has no Sitemap: line.");
  }
} catch (error) {
  console.log(`  WARNING: could not fetch robots.txt: ${error.message}`);
}

// F-007/F-349 fix: canonical/OG/sitemap and every emailed order/
// unsubscribe/back-in-stock link are built from NEXT_PUBLIC_SITE_URL — if
// it's a Vercel team-scoped alias, all of those hit an SSO login wall
// instead of the site. Unlike noindex, there is no legitimate reason for
// this to happen in production, so it always aborts (no --allow-noindex
// override).
const canonicalHref = extractCanonicalHref(homepageHtml);
if (canonicalHref && isLikelyProtectedVercelAlias(canonicalHref)) {
  die(
    `canonical URL ${canonicalHref} is an SSO-protected Vercel alias (ends in "-projects.vercel.app` +
      '"). Set NEXT_PUBLIC_SITE_URL to the public origin (this deployment\'s own alias, or the ' +
      "custom domain) and redeploy — see F-007.",
  );
}

console.log(`\nLive: ${deployedUrl}`);
