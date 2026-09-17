import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

export function isPostgresDatabaseUrl(url?: string): boolean {
  const value = url ?? process.env.DATABASE_URL ?? "";
  return value.startsWith("postgres://") || value.startsWith("postgresql://");
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

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // Serverless functions each get their own pool; keep it small so a
    // burst of concurrent invocations can't exhaust the database's
    // connection limit. Use a pooled connection string (e.g. Neon's or
    // PgBouncer) in production rather than raising this.
    max: Number(process.env.DB_POOL_MAX ?? 5),
  });
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}
