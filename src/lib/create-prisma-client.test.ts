import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isPostgresDatabaseUrl } from "@/lib/create-prisma-client";

describe("createPrismaClient helpers", () => {
  it("detects postgres URLs", () => {
    assert.equal(
      isPostgresDatabaseUrl("postgresql://user:pass@localhost:5432/db"),
      true,
    );
    assert.equal(isPostgresDatabaseUrl("postgres://user:pass@localhost/db"), true);
    assert.equal(isPostgresDatabaseUrl("file:./dev.db"), false);
  });
});
