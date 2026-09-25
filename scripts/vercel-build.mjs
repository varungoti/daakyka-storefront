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

async function migrateWithRetry(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      run("npx prisma migrate deploy");
      return;
    } catch {
      if (attempt === maxAttempts) {
        console.error(`prisma migrate deploy failed after ${maxAttempts} attempts`);
        process.exit(1);
      }
      const waitMs = attempt * 8000;
      console.warn(
        `Migrate lock timeout (attempt ${attempt}/${maxAttempts}). Retrying in ${waitMs / 1000}s…`,
      );
      await sleep(waitMs);
    }
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

    // prisma/seed.ts is create-only (an existing row's data is never
    // overwritten), so running it on every deploy is safe: it only ever
    // bootstraps the admin user and default content the first time. On
    // Vercel it also refuses to run at all without a real, non-default
    // ADMIN_SEED_PASSWORD — see prisma/seed.ts's resolveAdminSeedPassword.
    console.log("\n▶ prisma seed");
    run("npx tsx prisma/seed.ts");
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
