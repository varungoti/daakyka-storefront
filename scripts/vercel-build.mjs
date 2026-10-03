/**
 * Vercel production build with resilient Prisma migrate (retries advisory lock timeouts).
 */
import { execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

function run(command, extraEnv) {
  execSync(command, {
    stdio: "inherit",
    shell: true,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });
}

/**
 * Like `run()`, but captures stdout/stderr instead of streaming them live,
 * so the caller can inspect what Prisma actually printed. Printed as one
 * block once the command finishes either way, so nothing is lost — this
 * only delays it by however long a single `prisma migrate deploy` takes,
 * not the whole retry loop below.
 */
function runCapture(command, extraEnv) {
  // Both streams explicitly piped (not the execSync default, which
  // inherits stderr live) so nothing prints twice: this fully captures
  // the output first, then writes it out exactly once below, whichever
  // branch runs.
  const options = {
    encoding: "utf8",
    shell: true,
    stdio: ["inherit", "pipe", "pipe"],
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  };
  try {
    const stdout = execSync(command, options);
    process.stdout.write(stdout);
    return { ok: true, output: stdout };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    process.stdout.write(output);
    return { ok: false, output };
  }
}

// F-353: only retry a genuine advisory-lock contention — Prisma error
// P1002 ("Timed out trying to acquire a lock"), the exact scenario this
// retry loop exists for (several build workers racing to migrate the same
// database concurrently). This used to retry EVERY failure up to
// `maxAttempts` times, including a migration that will never succeed no
// matter how many times it's retried (a broken migration's P3009/P3018,
// a SQL syntax error, ...) — burning ~2 minutes of build time relabeling
// it "Migrate lock timeout" before finally reporting the real error.
export function isLockTimeout(output) {
  return /P1002\b/.test(output) || /Timed out trying to acquire a lock/i.test(output);
}

async function migrateWithRetry(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = runCapture("npx prisma migrate deploy");
    if (result.ok) return;

    if (!isLockTimeout(result.output)) {
      console.error("prisma migrate deploy failed (not a lock timeout — not retrying; see output above)");
      process.exit(1);
    }
    if (attempt === maxAttempts) {
      console.error(`prisma migrate deploy failed after ${maxAttempts} lock-timeout attempts`);
      process.exit(1);
    }
    const waitMs = attempt * 8000;
    console.warn(
      `Migrate lock timeout (attempt ${attempt}/${maxAttempts}). Retrying in ${waitMs / 1000}s…`,
    );
    await sleep(waitMs);
  }
}

// F-229: this one script builds every environment (vercel.json's
// buildCommand applies to Preview and Production alike), and it used to
// run `prisma migrate deploy` + the seed unconditionally — so pushing ANY
// branch built a Preview that applied that branch's unreviewed migrations
// and seeded an admin user against the SAME Supabase pooler database
// Production uses, with no review step. Vercel sets VERCEL_ENV to
// "production" only for actual production deploys (it's unset locally,
// "preview" for a branch/PR deploy); gate the two DB-mutating steps on
// it. A Preview environment deliberately pointed at its own staging
// database can still opt in with RUN_DB_MIGRATIONS=1. See
// docs/GO_LIVE_RUNBOOK.md.
//
// Exported (and pure) so scripts/vercel-build.test.ts can assert this
// branch decision directly without running an actual build.
/** @param {Record<string, string | undefined>} [env] */
export function computeShouldMigrate(env = process.env) {
  return env.VERCEL_ENV === "production" || env.RUN_DB_MIGRATIONS === "1";
}

const shouldMigrate = computeShouldMigrate();

async function main() {
  console.log("\n▶ prisma generate");
  run("npx prisma generate");

  if (shouldMigrate) {
    console.log("\n▶ prisma migrate deploy (with retry)");
    await migrateWithRetry();

    // prisma/seed.ts is safe to run on every deploy: the admin/viewer
    // users, homepage sections, integration settings and site-setting
    // defaults are create-only (an existing row is never overwritten), and
    // real /admin content (blog posts, SEO records, segments, templates,
    // journeys, offers) is only ever (re-)seeded once per database — see
    // ensureContentSeeded() in prisma/seed.ts (F-223) — so an admin's
    // deletion of seeded content is never undone by a later deploy. On
    // Vercel it also refuses to run at all without a real, non-default
    // ADMIN_SEED_PASSWORD — see prisma/seed.ts's resolveAdminSeedPassword.
    console.log("\n▶ prisma seed");
    run("npx tsx prisma/seed.ts");

    if (process.env.VERCEL_ENV === "production") {
      console.log("\n▶ seed reviewed Kids Wear concepts as non-purchasable drafts");
      run("npx tsx prisma/seed-kids-concepts.ts");
    }

    if (process.env.VERCEL_ENV === "production") {
      console.log("\n▶ sync reviewed generated product images");
      run("npx tsx scripts/sync-generated-product-images.ts --apply");
    }
  } else {
    console.log(
      `\n▶ skipping prisma migrate/seed (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"}; ` +
        "set RUN_DB_MIGRATIONS=1 to opt a non-production environment in)",
    );
  }

  console.log("\n▶ next build");
  // F-074: static generation runs several build workers in parallel, each
  // opening its own pg.Pool (src/lib/create-prisma-client.ts). At the
  // default DB_POOL_MAX, 3 build workers alone can claim Supabase's
  // entire session-pooler budget (EMAXCONNSESSION), which starves the
  // build of real DB access partway through and silently bakes the
  // legacy fallback catalog (src/data/products.ts) into static output
  // like the sitemap until the next deploy. Cap the per-worker pool for
  // this step specifically, unless the caller already set DB_POOL_MAX
  // explicitly.
  run("npx next build", { DB_POOL_MAX: process.env.DB_POOL_MAX ?? "2" });

  console.log("\n✓ Vercel build complete\n");
}

// Only run the build when this file is executed directly (`node
// scripts/vercel-build.mjs`, as vercel.json's buildCommand does) — not
// when scripts/vercel-build.test.ts imports computeShouldMigrate above.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
