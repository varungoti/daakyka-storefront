import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeShouldMigrate } from "./vercel-build.mjs";

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
