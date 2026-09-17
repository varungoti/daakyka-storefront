import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient, isPostgresDatabaseUrl } from "@/lib/create-prisma-client";

describe("createPrismaClient helpers", () => {
  it("detects postgres URLs", () => {
    assert.equal(
      isPostgresDatabaseUrl("postgresql://user:pass@localhost:5432/db"),
      true,
    );
    assert.equal(isPostgresDatabaseUrl("postgres://user:pass@localhost/db"), true);
    assert.equal(isPostgresDatabaseUrl("file:./dev.db"), false);
  });

  it("rejects a non-Postgres DATABASE_URL instead of falling back to SQLite", () => {
    assert.throws(() => createPrismaClient("file:./dev.db"), /postgres/i);
    assert.throws(() => createPrismaClient(""), /postgres/i);
  });
});
