/** Vercel's compile entry point. No migration, seeding, or image writes. */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** @param {Record<string, string | undefined>} env */
export function buildDatabaseEnvironment(env = process.env) {
  let url;
  try { url = new URL(env.BUILD_DATABASE_URL ?? ""); } catch { /* report without revealing URL */ }
  if (!url || !/^postgres(ql)?:$/.test(url.protocol) || !url.hostname ||
      !url.username || !url.pathname.slice(1)) {
    throw new Error("BUILD_DATABASE_URL must name a PostgreSQL database and a dedicated read-only build role.");
  }
  if (["host", "hostaddr", "user", "dbname", "port", "database", "options"].some((key) => url.searchParams.has(key))) {
    throw new Error("BUILD_DATABASE_URL must express its target in the URL authority, without query overrides.");
  }
  const fixture = env.DAAKYKA_LOCAL_FIXTURE === "1";
  if (fixture && (env.VERCEL || !LOOPBACK.has(url.hostname) || env.NEXT_PUBLIC_ALLOW_INDEXING !== "false")) {
    throw new Error("Local fixture builds require a loopback database, no indexing, and no Vercel platform context.");
  }
  if (!fixture && (LOOPBACK.has(url.hostname) || url.searchParams.getAll("sslmode").join(",") !== "verify-full")) {
    throw new Error("Hosted builds require a non-loopback build database and sslmode=verify-full.");
  }

  if (!fixture) {
    let runtime;
    try { runtime = new URL(env.DATABASE_URL ?? ""); } catch { /* no credentials in errors */ }
    const overrides = ["host", "hostaddr", "user", "dbname", "port", "database", "options"];
    if (!runtime || !/^postgres(ql)?:$/.test(runtime.protocol) ||
        overrides.some((key) => runtime.searchParams.has(key)) ||
        runtime.hostname !== url.hostname || runtime.pathname !== url.pathname ||
        runtime.username === url.username) {
      throw new Error("BUILD_DATABASE_URL and DATABASE_URL must target the same host and database, with distinct roles.");
    }
    // Supabase's shared pooler encodes tenant identity in username.project-ref.
    if (url.hostname.endsWith(".pooler.supabase.com")) {
      const tenant = (username) => decodeURIComponent(username).split(".").slice(1).join(".");
      if (!tenant(url.username) || tenant(url.username) !== tenant(runtime.username)) {
        throw new Error("Build and runtime Supabase pooler URLs identify different projects.");
      }
    }
  }

  // Both Prisma's config and Next's server-side prerender queries must
  // receive only the non-writer build role, never the operator credential.
  /** @type {Record<string, string | undefined>} */
  const childEnv = { ...env, DATABASE_URL: url.href, MIGRATION_DATABASE_URL: url.href, DB_POOL_MAX: env.DB_POOL_MAX ?? "2" };
  delete childEnv.SUPABASE_DATABASE_URL;
  return { databaseUrl: url.href, databaseHost: url.hostname, fixture, childEnv };
}

const MIGRATIONS = new URL("../prisma/migrations/", import.meta.url);
const digest = (content) => createHash("sha256").update(content).digest("hex");
export function expectedMigrations(root = MIGRATIONS) {
  return new Map(readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => {
    const raw = readFileSync(new URL(name + "/migration.sql", root), "utf8");
    const lf = raw.replace(/\r\n/g, "\n");
    return [name, new Set([digest(lf), digest(lf.replace(/\n/g, "\r\n"))])];
  }));
}

export function assertMigrationHistory(expected, rows) {
  const completed = new Map();
  for (const row of rows) {
    if (row.rolled_back_at) continue;
    if (!row.finished_at || completed.has(row.migration_name)) {
      throw new Error("Build database has an unfinished or ambiguous migration: " + row.migration_name);
    }
    completed.set(row.migration_name, row.checksum);
  }
  for (const [name, checksums] of expected) {
    if (!checksums.has(completed.get(name))) {
      throw new Error("Build database migration is absent or differs from the checked-out source: " + name);
    }
  }
  if (completed.size !== expected.size) {
    throw new Error("Build database contains migrations not present in this checkout.");
  }
}

export async function verifySchemaReadOnly(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, query_timeout: 8000 });
  let ledger;
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const result = await client.query(
      "SELECT current_setting('default_transaction_read_only') = 'on' AS readonly, " +
      "NOT has_schema_privilege(current_user, 'public', 'CREATE') AS no_schema_create, " +
      "NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND " +
      "has_table_privilege(current_user, quote_ident(schemaname) || '.' || quote_ident(tablename), " +
      "'INSERT,UPDATE,DELETE,TRUNCATE')) AS no_table_writes",
    );
    const [permission] = result.rows;
    if (!permission?.readonly || !permission.no_schema_create || !permission.no_table_writes) {
      throw new Error("BUILD_DB_ROLE_WRITABLE");
    }
    ({ rows: ledger } = await client.query(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM public."_prisma_migrations"',
    ));
    // Verify the tables used in anonymous static pages, which normally
    // fall back to bundled demo data on a database read failure.
    await client.query('SELECT "slug", "status" FROM public."Product" LIMIT 0');
    await client.query('SELECT "productId" FROM public."ProductVariant" LIMIT 0');
    for (const table of ["Category", "SiteSetting", "BlogPostRecord"]) {
      await client.query('SELECT * FROM public."' + table + '" LIMIT 0');
    }
    await client.query("ROLLBACK");
  } catch (error) {
    if (error.message === "BUILD_DB_ROLE_WRITABLE") {
      throw new Error("Refusing to compile with a database build role that can write. Use a dedicated read-only role.");
    }
    throw new Error("Vercel compile stopped: the build database schema could not be read. Verify the read-only connection, grants, and migrations.");
  } finally {
    await client.end().catch(() => {});
  }
  assertMigrationHistory(expectedMigrations(), ledger);
}

async function main() {
  const { databaseUrl, databaseHost, childEnv, fixture } = buildDatabaseEnvironment();
  await verifySchemaReadOnly(databaseUrl);
  // Kept compatible with the rollback verifier's hostname-only parser.
  console.log('Datasource "db": read-only PostgreSQL schema at "' + databaseHost + '"');
  console.log("Read-only database schema matches this checkout.");
  if (fixture) console.log("SYNTHETIC FIXTURE BUILD. DO NOT DEPLOY THIS ARTIFACT.");
  execSync("npm run build", { stdio: "inherit", env: childEnv });
  if (fixture) {
    writeFileSync(".next/DO_NOT_DEPLOY_SYNTHETIC_FIXTURE", "The static pages include disposable synthetic data. Rebuild the exact source with the approved hosted read-only database role.\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.status ? "Vercel compile did not complete. See the build output above." : error.message);
    process.exitCode = 1;
  });
}
