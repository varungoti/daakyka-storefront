import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

export function isPostgresDatabaseUrl(url?: string): boolean {
  const value = url ?? process.env.DATABASE_URL ?? "";
  return value.startsWith("postgres://") || value.startsWith("postgresql://");
}

/**
 * F-368: node-postgres's own defaults for all four of these are "wait
 * forever" (see node_modules/pg/lib/defaults.js and client.js) — a
 * wedged/partitioned connection (the far end accepts the TCP connection
 * but never answers, distinct from a plain refused/closed port) hung
 * every DB-touching route for 60s+ with no fast failure. Exported so
 * tests can build an identically-configured pool against a fixture (a TCP
 * listener that never responds) without needing a real Postgres server —
 * see create-prisma-client.test.ts.
 */
export function buildPoolConfig(databaseUrl: string | undefined): pg.PoolConfig {
  return {
    connectionString: databaseUrl,
    // Serverless functions each get their own pool; keep it small so a
    // burst of concurrent invocations can't exhaust the database's
    // connection limit (e.g. Supabase's session-pooler client cap —
    // F-074). Use a pooled connection string (e.g. Neon's or PgBouncer)
    // in production rather than raising this.
    max: Number(process.env.DB_POOL_MAX ?? 2),
    // Bounds "wait for a free pool slot" and "TCP-connect a new client".
    connectionTimeoutMillis: 5000,
    // Server-side (Postgres GUC) cutoff for a single statement — only
    // fires once a connection is actually established.
    statement_timeout: 8000,
    // Client-side timer, independent of any server response — this is
    // what actually bounds a connection that authenticated fine but then
    // goes silent mid-query (a wedged pooler, not just a refused one).
    query_timeout: 10000,
    // Don't let a stalled `$transaction` hold a slot indefinitely.
    idle_in_transaction_session_timeout: 10000,
  };
}

/**
 * True for a pg/Prisma error that means "the database is temporarily
 * unreachable or too slow to answer" — a wedged/partitioned connection
 * (bounded by the timeouts above), a refused connection, or Supabase's
 * session-pooler EMAXCONNSESSION cap (F-074) — as opposed to a query that
 * ran and failed for a data reason (constraint violation, not found,
 * etc.). Callers use this to answer with a clean 503 instead of an opaque
 * 500, and to tell a real "logged out" apart from "the DB blipped" (see
 * src/lib/auth/session.ts).
 */
export function isDbUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { code?: unknown; message?: unknown; name?: unknown; cause?: unknown };

  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  // Prisma "can't reach database server" / timed out / server closed the
  // connection. Postgres 57014 = query_canceled (statement_timeout),
  // 25P03 = idle_in_transaction_session_timeout. ECONNREFUSED/ETIMEDOUT/
  // ECONNRESET are the raw node-postgres socket error codes.
  if (
    code &&
    ["P1001", "P1002", "P1008", "P1017", "57014", "25P03", "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET"].includes(
      code,
    )
  ) {
    return true;
  }
  if (candidate.name === "PrismaClientInitializationError") return true;

  const message = typeof candidate.message === "string" ? candidate.message : "";
  if (
    /connection terminated due to connection timeout/i.test(message) ||
    /timeout exceeded when trying to connect/i.test(message) ||
    /query read timeout/i.test(message) ||
    /timeout expired/i.test(message) ||
    /connection terminated unexpectedly/i.test(message) ||
    /can'?t reach database server/i.test(message) ||
    /emaxconnsession/i.test(message) ||
    /max clients reached/i.test(message)
  ) {
    return true;
  }

  // Prisma/driver-adapter errors often wrap the real cause in `.cause`.
  if (candidate.cause && candidate.cause !== err) return isDbUnavailableError(candidate.cause);

  return false;
}

/**
 * The generated Prisma client's query engine is compiled for the
 * `postgresql` provider only (see prisma/schema.prisma) — there is no
 * SQLite fallback. A missing or non-Postgres DATABASE_URL fails fast
 * and clearly here, instead of constructing a client that would throw a
 * much less obvious PrismaClientInitializationError on first query.
 */
export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
  if (!isPostgresDatabaseUrl(databaseUrl)) {
    throw new Error(
      "DATABASE_URL must be a postgres:// or postgresql:// connection string. " +
        "Run `docker compose up -d postgres` and set DATABASE_URL in .env " +
        "(see .env.local.example) for local development.",
    );
  }

  const pool = new pg.Pool(buildPoolConfig(databaseUrl));
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}
