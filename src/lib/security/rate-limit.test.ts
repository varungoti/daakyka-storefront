import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { checkRateLimit, rateLimitOrResponse, resetRateLimits } from "@/lib/security/rate-limit";
import { withEnv } from "../../../tests/helpers/env";

/**
 * DB-backed rate limiter (v1 2.1). getClientIp's trusted-header
 * precedence is covered in src/lib/env.test.ts; this file covers the
 * atomic-increment/reset semantics against the real Postgres table, the
 * fail-open fallback when the DB is unreachable, and (below) the F1
 * spoofed-X-Forwarded-For regression at the rateLimitOrResponse level.
 */
describe("rate-limit (DB-backed)", () => {
  after(async () => {
    await resetRateLimits();
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

/**
 * F1 regression (docs/audit-2026-09-19/security.md): "5 plain login
 * attempts hit the 429 limit; 8 further attempts each with a rotated
 * fake X-Forwarded-For (10.0.0.1…10.0.0.8) all sailed through at 401."
 * These exercise the fix at the same level the exploit was verified at —
 * rateLimitOrResponse() deciding whether to 429 a real Request — rather
 * than just unit-testing getClientIp() in isolation.
 */
describe("rateLimitOrResponse resists X-Forwarded-For spoofing (F1)", () => {
  after(async () => {
    await resetRateLimits();
  });

  function silenceConsoleWarn<T>(fn: () => Promise<T>): Promise<T> {
    const original = console.warn;
    console.warn = () => {};
    return fn().finally(() => {
      console.warn = original;
    });
  }

  it("rotating a spoofed X-Forwarded-For no longer resets/evades the bucket once a trusted platform header is present (Vercel)", async () => {
    await resetRateLimits();
    await withEnv(
      { NODE_ENV: "production", DISABLE_RATE_LIMIT: undefined, VERCEL: "1" },
      async () => {
        const route = `f1-vercel-spoof-${randomUUID()}`;
        const realIp = "203.0.113.50";
        const makeRequest = (spoofedHop: string) =>
          new Request("http://localhost/api/auth/login", {
            headers: {
              "x-vercel-forwarded-for": realIp,
              // The attacker rotates this on every request hoping it's
              // still used to pick the bucket — it must be ignored
              // entirely once a Vercel-set header is present.
              "x-forwarded-for": spoofedHop,
            },
          });

        for (let i = 0; i < 3; i += 1) {
          const response = await rateLimitOrResponse(makeRequest(`10.0.0.${i}`), route, 3, 60_000);
          assert.equal(response, null, `request ${i} should still be within the limit`);
        }

        // A 4th request, still with a brand-new spoofed hop, must now be
        // blocked: rotating x-forwarded-for did not create a fresh
        // bucket because the trusted x-vercel-forwarded-for value — not
        // the client-controlled header — decided the bucket key.
        const blocked = await rateLimitOrResponse(makeRequest("10.0.0.99"), route, 3, 60_000);
        assert.ok(blocked, "expected the 4th request (still spoofing a new hop) to be rate-limited");
        assert.equal(blocked!.status, 429);
      },
    );
  });

  it("never lets unattributed callers share one bucket off-platform (no shared-lockout DoS)", async () => {
    await resetRateLimits();
    await silenceConsoleWarn(() =>
      withEnv(
        {
          NODE_ENV: "production",
          DISABLE_RATE_LIMIT: undefined,
          VERCEL: undefined,
          TRUST_PROXY_HEADERS: undefined,
        },
        async () => {
          const route = `f1-no-trust-${randomUUID()}`;
          // Different "attackers" spoofing different IPs, plus a request
          // with no forwarded headers at all. None of them has a
          // trustworthy signal, so none of them should ever be able to
          // exhaust a shared bucket and 429 the others — the whole point
          // of returning null instead of a constant "unknown" key.
          const requests = [
            new Request("http://localhost/api/auth/login", { headers: { "x-forwarded-for": "10.0.0.1" } }),
            new Request("http://localhost/api/auth/login", { headers: { "x-forwarded-for": "10.0.0.2" } }),
            new Request("http://localhost/api/auth/login"),
          ];

          for (let round = 0; round < 5; round += 1) {
            for (const request of requests) {
              const response = await rateLimitOrResponse(request, route, 1, 60_000);
              assert.equal(
                response,
                null,
                "unattributed requests must never be rate-limited into a shared bucket",
              );
            }
          }
        },
      ),
    );
  });
});
