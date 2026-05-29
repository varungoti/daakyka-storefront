import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

export function isPostgresDatabaseUrl(url?: string): boolean {
  const value = url ?? process.env.DATABASE_URL ?? "";
  return value.startsWith("postgres://") || value.startsWith("postgresql://");
}

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
  const url = databaseUrl ?? "file:./dev.db";

  if (isPostgresDatabaseUrl(url)) {
    const pool = new pg.Pool({ connectionString: url });
    return new PrismaClient({ adapter: new PrismaPg(pool) });
  }

  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url }),
  });
}
