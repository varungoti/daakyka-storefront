import { describe, it } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import pg from "pg";
import {
  buildPoolConfig,
  createPrismaClient,
  isDbUnavailableError,
  isPostgresDatabaseUrl,
} from "@/lib/create-prisma-client";

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

  it("builds a pool config with explicit, bounded timeouts (F-368)", () => {
    const config = buildPoolConfig("postgresql://user:pass@localhost:5432/db");
    assert.equal(config.connectionTimeoutMillis, 5000);
    assert.equal(config.statement_timeout, 8000);
    assert.equal(config.query_timeout, 10000);
    assert.equal(config.idle_in_transaction_session_timeout, 10000);
    assert.equal(config.max, Number(process.env.DB_POOL_MAX ?? 5));
  });
});

describe("isDbUnavailableError (F-368/F-369)", () => {
  it("recognizes pg's own timeout error messages", () => {
    assert.equal(
      isDbUnavailableError(new Error("Connection terminated due to connection timeout")),
      true,
    );
    assert.equal(isDbUnavailableError(new Error("timeout exceeded when trying to connect")), true);
    assert.equal(isDbUnavailableError(new Error("Query read timeout")), true);
  });

  it("recognizes Prisma connection error codes and Supabase's pooler cap", () => {
    assert.equal(isDbUnavailableError({ code: "P1001", message: "Can't reach database server" }), true);
    assert.equal(
      isDbUnavailableError({ message: "(EMAXCONNSESSION) max clients reached in session mode" }),
      true,
    );
    assert.equal(isDbUnavailableError({ name: "PrismaClientInitializationError", message: "x" }), true);
  });

  it("unwraps a wrapped cause", () => {
    const inner = new Error("ETIMEDOUT");
    Object.assign(inner, { code: "ETIMEDOUT" });
    const wrapper = new Error("DriverAdapterError", { cause: inner });
    assert.equal(isDbUnavailableError(wrapper), true);
  });

  it("does not misclassify an ordinary data error", () => {
    assert.equal(isDbUnavailableError({ code: "P2002", message: "Unique constraint failed" }), false);
    assert.equal(isDbUnavailableError(new Error("Product not found")), false);
    assert.equal(isDbUnavailableError(null), false);
    assert.equal(isDbUnavailableError("just a string"), false);
  });
});

/**
 * F-368 regression: a wedged/partitioned connection (the far end accepts
 * the TCP connection but never answers a byte — distinct from a plain
 * refused/closed port) must fail fast with a bounded, classifiable error
 * instead of hanging indefinitely. Uses the same hang-proxy pattern as
 * scratchpad/audit-work/verify-f368/{tiny-hang-proxy.cjs,repro.cjs}: a
 * plain TCP listener that swallows every byte, so no real Postgres or
 * credentials are needed.
 */
describe("pg.Pool with buildPoolConfig against a wedged connection (F-368)", () => {
  it("rejects within the bounded timeout instead of hanging indefinitely", async () => {
    const hangServer = net.createServer((socket) => {
      socket.on("data", () => {
        /* swallow silently: simulate a partition/wedged pooler */
      });
    });
    const port = await new Promise<number>((resolve, reject) => {
      hangServer.on("error", reject);
      hangServer.listen(0, "127.0.0.1", () => {
        const address = hangServer.address();
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("failed to bind hang server"));
      });
    });

    const pool = new pg.Pool(
      buildPoolConfig(`postgresql://placeholder_user:placeholder_pass@127.0.0.1:${port}/placeholder_db`),
    );

    const start = Date.now();
    try {
      await assert.rejects(() => pool.query("SELECT 1"));
      const elapsedMs = Date.now() - start;
      // connectionTimeoutMillis is 5000ms; allow generous scheduling slack
      // but this must be nowhere near an indefinite hang.
      assert.ok(elapsedMs < 15000, `expected a bounded failure, took ${elapsedMs}ms`);
    } finally {
      await pool.end();
      hangServer.close();
    }
  });
});
