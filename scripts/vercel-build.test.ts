import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertMigrationHistory, buildDatabaseEnvironment, expectedMigrations } from "./vercel-build.mjs";
import { isLockTimeout, releasePlan } from "./vercel-db-release.mjs";

const readUrl = "postgresql://build:test@db.example.com:5432/storefront?sslmode=verify-full";
const writerUrl = "postgresql://operator:test@db.example.com:5432/storefront?sslmode=verify-full";

describe("read-only Vercel compile", () => {
  it("verifies the exact command selected by vercel.json and delegates to the ordinary build", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
    assert.equal(config.buildCommand, "node scripts/vercel-build.mjs");
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(packageJson.scripts.build, "prisma generate && next build");
    assert.match(readFileSync(new URL("./vercel-build.mjs", import.meta.url), "utf8"), /execSync\("npm run build"/);
  });

  it("pins both renderer and generator to the build credential, ignoring legacy opt-in and operator URLs", () => {
    const { childEnv, fixture } = buildDatabaseEnvironment({
      VERCEL: "1", VERCEL_ENV: "production", RUN_DB_MIGRATIONS: "1",
      BUILD_DATABASE_URL: readUrl, DATABASE_URL: writerUrl, MIGRATION_DATABASE_URL: writerUrl,
      SUPABASE_DATABASE_URL: writerUrl,
    });
    assert.equal(childEnv.DATABASE_URL, readUrl);
    assert.equal(childEnv.MIGRATION_DATABASE_URL, readUrl);
    assert.equal(childEnv.SUPABASE_DATABASE_URL, undefined);
    assert.equal(fixture, false);
  });

  it("fails closed if the build credential is absent, non-Postgres, uncertain, or about to target hosted loopback", () => {
    for (const BUILD_DATABASE_URL of [undefined, "file:dev.db", readUrl.replace("verify-full", "require"),
      readUrl + "&host=elsewhere.example.com", "postgresql://build:test@localhost/storefront?sslmode=verify-full"]) {
      assert.throws(() => buildDatabaseEnvironment({ BUILD_DATABASE_URL, VERCEL: "1" }));
    }
  });

  it("rejects a hosted build when runtime points at a different database or tenant", () => {
    assert.throws(() => buildDatabaseEnvironment({ BUILD_DATABASE_URL: readUrl, DATABASE_URL: writerUrl.replace("storefront", "other"), VERCEL: "1" }), /same host and database/);
    const a = "postgresql://reader.projectone:test@aws-0.pooler.supabase.com:5432/postgres?sslmode=verify-full";
    const b = "postgresql://writer.projecttwo:test@aws-0.pooler.supabase.com:6543/postgres?sslmode=verify-full";
    assert.throws(() => buildDatabaseEnvironment({ BUILD_DATABASE_URL: a, DATABASE_URL: b, VERCEL: "1" }), /different projects/);
    assert.doesNotThrow(() => buildDatabaseEnvironment({ BUILD_DATABASE_URL: a, DATABASE_URL: b.replace("projecttwo", "projectone"), VERCEL: "1" }));
  });

  it("allows local loopback databases only in explicit unindexed fixture mode outside Vercel", () => {
    const env = {
      DAAKYKA_LOCAL_FIXTURE: "1", NEXT_PUBLIC_ALLOW_INDEXING: "false",
      BUILD_DATABASE_URL: "postgresql://build:test@127.0.0.1/storefront",
    };
    assert.equal(buildDatabaseEnvironment(env).fixture, true);
    assert.throws(() => buildDatabaseEnvironment({ ...env, VERCEL: "1" }));
    assert.throws(() => buildDatabaseEnvironment({ ...env, NEXT_PUBLIC_ALLOW_INDEXING: "true" }));
    assert.throws(() => buildDatabaseEnvironment({ ...env, BUILD_DATABASE_URL: readUrl }));
  });

  it("requires the complete exact migration ledger, rejecting pending, altered, duplicate, or future migrations", () => {
    const expected = expectedMigrations();
    assert.ok(expected.size > 0);
    const good = [...expected].map(([migration_name, checksums]) => ({
      migration_name, checksum: [...checksums][0], finished_at: "done", rolled_back_at: null,
    }));
    assert.doesNotThrow(() => assertMigrationHistory(expected, good));
    assert.throws(() => assertMigrationHistory(expected, good.slice(1)), /absent or differs/);
    assert.throws(() => assertMigrationHistory(expected, [{ ...good[0], checksum: "wrong" }, ...good.slice(1)]), /absent or differs/);
    assert.throws(() => assertMigrationHistory(expected, [{ ...good[0], finished_at: null }, ...good.slice(1)]), /unfinished/);
    assert.throws(() => assertMigrationHistory(expected, [good[0], ...good]), /ambiguous/);
    assert.throws(() => assertMigrationHistory(expected, [...good, { ...good[0], migration_name: "future" }]), /not present/);
    assert.doesNotThrow(() => assertMigrationHistory(expected, [...good, { ...good[0], rolled_back_at: "yes" }]));
  });
});

describe("operator-only database release", () => {
  const args = ["--apply", "--target=production", "--expect-host=db.example.com", "--expect-database=storefront", "--expect-role=operator"];
  const env = { MIGRATION_DATABASE_URL: writerUrl, DATABASE_URL: readUrl, ADMIN_SEED_PASSWORD: "synthetic-unit-test-only" };

  it("never runs with missing apply authorization, uncertain target, duplicate selection, or on Vercel", () => {
    assert.throws(() => releasePlan(args.slice(1), env));
    assert.throws(() => releasePlan([...args, "--target=staging"], env));
    assert.throws(() => releasePlan(args.map((arg) => arg === "--expect-role=operator" ? "--expect-role=build" : arg), env));
    assert.throws(() => releasePlan(args, { ...env, VERCEL: "1" }));
    assert.throws(() => releasePlan(args, { ...env, ADMIN_SEED_PASSWORD: "short" }));
  });

  it("uses the reviewed writer URL for migration and seed, not stale DATABASE_URL", () => {
    const plan = releasePlan(args, env);
    assert.equal(plan.target, "production");
    assert.equal(plan.childEnv.DATABASE_URL, writerUrl);
    assert.equal(plan.childEnv.MIGRATION_DATABASE_URL, writerUrl);
    assert.equal(plan.childEnv.VERCEL_ENV, "production");
  });

  it("retries only Prisma advisory lock contention", () => {
    assert.equal(isLockTimeout("Error: P1002: The database server was reached but timed out"), true);
    assert.equal(isLockTimeout("Timed out trying to acquire a lock"), true);
    assert.equal(isLockTimeout("Error: P3009"), false);
    assert.equal(isLockTimeout('Error: P3018 relation "EmailOutbox" already exists'), false);
    assert.equal(isLockTimeout("command not found: npx"), false);
  });
});
