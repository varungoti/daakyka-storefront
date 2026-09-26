import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeShouldMigrate, isLockTimeout } from "./vercel-build.mjs";

/**
 * F-229 regression: `prisma migrate deploy` + the seed must only run for
 * a real Vercel Production deploy, or when an environment explicitly opts
 * in with RUN_DB_MIGRATIONS=1 — never for an ordinary Preview build,
 * which previously ran both unconditionally against whatever DATABASE_URL
 * Preview had (once, the production Supabase database itself).
 *
 * Importing this module does not run the build: main() only executes
 * when the file is invoked directly (`node scripts/vercel-build.mjs`) —
 * see the import.meta.url guard at the bottom of that file.
 */
describe("vercel-build.mjs computeShouldMigrate (F-229)", () => {
  it("migrates on a real production deploy", () => {
    assert.equal(computeShouldMigrate({ VERCEL_ENV: "production" }), true);
  });

  it("does not migrate on an ordinary Preview build", () => {
    assert.equal(computeShouldMigrate({ VERCEL_ENV: "preview" }), false);
  });

  it("does not migrate locally (VERCEL_ENV unset)", () => {
    assert.equal(computeShouldMigrate({}), false);
  });

  it("lets a non-production environment opt in with RUN_DB_MIGRATIONS=1", () => {
    assert.equal(computeShouldMigrate({ VERCEL_ENV: "preview", RUN_DB_MIGRATIONS: "1" }), true);
  });

  it("does not opt in on any other RUN_DB_MIGRATIONS value", () => {
    assert.equal(computeShouldMigrate({ VERCEL_ENV: "preview", RUN_DB_MIGRATIONS: "true" }), false);
    assert.equal(computeShouldMigrate({ VERCEL_ENV: "preview", RUN_DB_MIGRATIONS: "0" }), false);
  });
});

/**
 * F-353 regression: the retry loop around `prisma migrate deploy` used to
 * retry EVERY failure as if it were the advisory-lock contention it was
 * built for, including a migration that will never succeed no matter how
 * many times it's retried (P3009/P3018, a SQL syntax error, ...). It must
 * only retry a genuine P1002 lock timeout.
 */
describe("vercel-build.mjs isLockTimeout (F-353)", () => {
  it("recognizes Prisma's P1002 lock-timeout error code", () => {
    assert.equal(
      isLockTimeout("Error: P1002: The database server was reached but timed out"),
      true,
    );
  });

  it("recognizes the lock-timeout message even without the error code", () => {
    assert.equal(isLockTimeout("Timed out trying to acquire a lock"), true);
  });

  it("does not treat a broken migration (P3009) as a lock timeout", () => {
    assert.equal(
      isLockTimeout("Error: P3009\nmigrate found failed migrations in the target database"),
      false,
    );
  });

  it("does not treat an already-applied-table error (P3018) as a lock timeout", () => {
    assert.equal(isLockTimeout('Error: P3018\nrelation "EmailOutbox" already exists'), false);
  });

  it("does not treat an unrelated failure as a lock timeout", () => {
    assert.equal(isLockTimeout("command not found: npx"), false);
  });
});
