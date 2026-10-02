/**
 * One shared guard for everything that writes test data or rebuilds a
 * database: refuse to run unless the target is a throwaway local Postgres.
 *
 * Why it exists (F-080): `npm run test:unit` / `test:integration` create and
 * delete orders, customers, admin users and credentials, and `verify:101` /
 * `verify:predeploy` also run `db:setup` (migrate + seed). All of them act on
 * whatever DATABASE_URL happens to be set, and the local `.env` deliberately
 * holds BOTH the local and the production (Supabase) URL. On 2026-09-21 the
 * two were swapped and `npm run verify` ran 791 tests against production.
 * Only the two cleanup scripts had any check, and a single copy of an
 * "is it Supabase" regex is not a safe default for a destructive test suite.
 *
 * The rules, in order:
 *   1. A database that is production is ALWAYS refused: it equals
 *      SUPABASE_DATABASE_URL, shares its host, or is a *.supabase.co/.com host.
 *      ALLOW_REMOTE_TEST_DB does not override this.
 *   2. Otherwise the host (and any `?host=` / `?hostaddr=` override, which
 *      node-postgres lets win over the URL's own host) must be local —
 *      localhost, 127.0.0.1, ::1, or the compose service name `postgres` —
 *      unless ALLOW_REMOTE_TEST_DB=1 says this remote database is disposable.
 *
 * Messages carry the host name only, never the URL or its password. Keep this
 * out of src/lib/db.ts: that code also runs on Vercel, where DATABASE_URL is
 * legitimately Supabase. This guard belongs at test and script entry points.
 */

import { readEnvFile } from "./read-env-file.mjs";

/** Hosts a disposable test database may live on without any override. */
export const LOCAL_DATABASE_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  // The docker-compose service name used by compose.local-ci.yml.
  "postgres",
]);

const SUPABASE_HOST = /(^|\.)supabase\.(co|com|net)$/i;

function normalizeHost(host) {
  // URL#hostname keeps the brackets on IPv6 literals.
  return host.replace(/^\[|\]$/g, "").toLowerCase();
}

/** Host name of a database URL, or null when it cannot be parsed. */
function hostsOf(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) return null;
  const hosts = [normalizeHost(url.hostname)];
  // node-postgres lets these query parameters override the URL's host.
  for (const name of ["host", "hostaddr"]) {
    const override = url.searchParams.get(name);
    if (override) hosts.push(normalizeHost(override));
  }
  return hosts;
}

/**
 * Describes why `databaseUrl` must not be used for destructive work, or
 * returns null when it is acceptable. Pure: no env reads, no output.
 *
 * @param {string | undefined} databaseUrl
 * @param {{ prodUrl?: string, allowRemote?: boolean, label?: string }} [options]
 *   `prodUrl` is SUPABASE_DATABASE_URL; `allowRemote` is ALLOW_REMOTE_TEST_DB=1.
 * @returns {string | null}
 */
export function databaseGuardProblem(databaseUrl, options = {}) {
  const { prodUrl, allowRemote = false, label = "DATABASE_URL" } = options;
  if (!databaseUrl) return `${label} is not set.`;

  if (prodUrl && databaseUrl === prodUrl) {
    return `${label} is identical to SUPABASE_DATABASE_URL (the production database).`;
  }

  const hosts = hostsOf(databaseUrl);
  if (!hosts) {
    return `${label} is not a parseable postgres:// or postgresql:// URL, so its host cannot be checked. ` +
      "Percent-encode special characters in the password (@ # % /).";
  }

  const prodHosts = prodUrl ? (hostsOf(prodUrl) ?? []) : [];
  for (const host of hosts) {
    if (SUPABASE_HOST.test(host) || prodHosts.includes(host)) {
      return `${label} points at "${host}", which is the production database host.`;
    }
  }

  if (!allowRemote) {
    const remote = hosts.find((host) => !LOCAL_DATABASE_HOSTS.has(host));
    if (remote !== undefined) {
      return `${label} points at "${remote}", which is not a local database ` +
        `(allowed: ${[...LOCAL_DATABASE_HOSTS].join(", ")}). ` +
        "Set ALLOW_REMOTE_TEST_DB=1 only if that remote database is genuinely disposable.";
    }
  }
  return null;
}

/**
 * Throws unless `databaseUrl` is a disposable database. See
 * {@link databaseGuardProblem} for the options.
 */
export function assertDisposableDatabase(databaseUrl, options = {}) {
  const problem = databaseGuardProblem(databaseUrl, options);
  if (problem) {
    throw new Error(
      `Refusing to run against this database: ${problem}\n` +
        "Point DATABASE_URL at a throwaway local Postgres (e.g. the docker-compose one) and re-run.",
    );
  }
}

/**
 * Checks every database URL a destructive run could reach — DATABASE_URL, and
 * MIGRATION_DATABASE_URL, which `prisma migrate deploy` prefers — straight
 * from the environment. A URL that is not set is not checked: nothing can
 * connect through it.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function assertDisposableEnvironment(env = process.env) {
  const options = {
    prodUrl: env.SUPABASE_DATABASE_URL || undefined,
    allowRemote: env.ALLOW_REMOTE_TEST_DB === "1",
  };
  if (env.DATABASE_URL) assertDisposableDatabase(env.DATABASE_URL, { ...options, label: "DATABASE_URL" });
  if (env.MIGRATION_DATABASE_URL) {
    assertDisposableDatabase(env.MIGRATION_DATABASE_URL, { ...options, label: "MIGRATION_DATABASE_URL" });
  }
}

/**
 * {@link assertDisposableEnvironment} for a script that spawns children with
 * `env`: the child also loads `.env` (prisma.config.ts imports dotenv, which
 * fills in whatever the environment leaves unset and never overrides), so a
 * MIGRATION_DATABASE_URL that exists only in `.env` is what `prisma migrate
 * deploy` would really use. This checks the environment as the child sees it.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string} [dotenvPath]
 */
export function assertDisposableRun(env = process.env, dotenvPath = ".env") {
  let fromFile = new Map();
  try {
    fromFile = readEnvFile(dotenvPath);
  } catch {
    // No .env file: nothing extra for a child to pick up.
  }
  assertDisposableEnvironment({ ...Object.fromEntries(fromFile), ...env });
}
