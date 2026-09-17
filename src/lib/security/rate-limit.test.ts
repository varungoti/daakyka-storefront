import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { checkRateLimit, getClientIp, resetRateLimits } from "@/lib/security/rate-limit";

/**
 * DB-backed rate limiter (v1 2.1). getClientIp and the basic
 * blocks-after-limit behavior are covered in src/lib/env.test.ts; this
 * file covers the atomic-increment/reset semantics against the real
 * Postgres table, plus the fail-open fallback when the DB is unreachable.
 */
describe("rate-limit (DB-backed)", () => {
  after(async () => {
    await resetRateLimits();
  });

  it("extracts the client IP from x-forwarded-for", () => {
    const request = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "198.51.100.7, 70.41.3.18" },
    });
    assert.equal(getClientIp(request), "198.51.100.7");
  });

  it("persists the bucket in RateLimitBucket and increments atomically", async () => {
    const key = `unit-test:${randomUUID()}`;
    const first = await checkRateLimit(key, 3, 60_000);
    assert.equal(first.ok, true);

    const row = await db.rateLimitBucket.findUnique({ where: { key } });
    assert.ok(row, "a bucket row should exist after the first check");
    assert.equal(row!.count, 1);

    await checkRateLimit(key, 3, 60_000);
    const third = await checkRateLimit(key, 3, 60_000);
    assert.equal(third.ok, true);

    const blocked = await checkRateLimit(key, 3, 60_000);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.ok(blocked.retryAfter >= 1);
    }

    await db.rateLimitBucket.delete({ where: { key } }).catch(() => {});
  });

  it("resets the count once the window has elapsed", async () => {
    const key = `unit-test-window:${randomUUID()}`;
    const windowMs = 150;

    const first = await checkRateLimit(key, 1, windowMs);
    assert.equal(first.ok, true);
    const blocked = await checkRateLimit(key, 1, windowMs);
    assert.equal(blocked.ok, false);

    await new Promise((resolve) => setTimeout(resolve, windowMs + 100));

    const afterWindow = await checkRateLimit(key, 1, windowMs);
    assert.equal(afterWindow.ok, true, "a new window should reset the counter to 1");

    await db.rateLimitBucket.delete({ where: { key } }).catch(() => {});
  });

  it("fails open (allows the request) when the database is unreachable", async () => {
    const key = `unit-test-failopen:${randomUUID()}`;
    const original = db.$queryRaw;
    // Intentionally stubbing a Prisma client method to simulate a DB
    // outage; restored in the finally block below.
    db.$queryRaw = (() => {
      throw new Error("simulated DB outage");
    }) as typeof db.$queryRaw;

    let originalWarn: typeof console.warn | undefined;
    try {
      originalWarn = console.warn;
      console.warn = () => {};
      const result = await checkRateLimit(key, 1, 60_000);
      assert.equal(result.ok, true, "should fail open rather than block or throw");
    } finally {
      db.$queryRaw = original;
      if (originalWarn) console.warn = originalWarn;
    }
  });
});
