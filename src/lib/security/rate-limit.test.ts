import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  checkRateLimit,
  hashIdentity,
  identityRateLimitOrResponse,
  rateLimitOrResponse,
  refundRateLimit,
  resetRateLimits,
} from "@/lib/security/rate-limit";
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
    await resetRateLimits(["unit-test"]);
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
    await resetRateLimits(["unit-test"]);
  });

  function silenceConsoleWarn<T>(fn: () => Promise<T>): Promise<T> {
    const original = console.warn;
    console.warn = () => {};
    return fn().finally(() => {
      console.warn = original;
    });
  }

  it("rotating a spoofed X-Forwarded-For no longer resets/evades the bucket once a trusted platform header is present (Vercel)", async () => {
    await resetRateLimits(["unit-test"]);
    await withEnv(
      { NODE_ENV: "production", DISABLE_RATE_LIMIT: undefined, VERCEL: "1" },
      async () => {
        // "unit-test" prefix so this file's after() sweep
        // (resetRateLimits(["unit-test"])) actually reaches the bucket.
        // Without it the row this test creates matched no cleanup at all
        // and leaked one RateLimitBucket row per run, forever, into the
        // shared dev/CI database.
        const route = `unit-test-f1-vercel-spoof-${randomUUID()}`;
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
    await resetRateLimits(["unit-test"]);
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

/**
 * F-123: refundRateLimit gives back one use of a bucket a caller consumed
 * for a request that then turned out not to be abuse (a shopper retrying
 * a broken cart, say) — see order-request-throttle.ts for the real
 * caller. Exercised directly here against the DB-backed bucket.
 */
describe("refundRateLimit (F-123)", () => {
  after(async () => {
    await resetRateLimits(["unit-test-refund"]);
  });

  it("gives back one use, so a refunded attempt doesn't count toward the limit", async () => {
    const key = `unit-test-refund:${randomUUID()}`;

    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit(key, 3, 60_000);
      assert.equal(result.ok, true, `attempt ${i + 1} should be allowed`);
    }
    // The bucket is now at its limit (3/3) — refund one use back.
    await refundRateLimit(key);

    const afterRefund = await checkRateLimit(key, 3, 60_000);
    assert.equal(afterRefund.ok, true, "a refunded bucket should allow one more request");

    const stillAtLimit = await checkRateLimit(key, 3, 60_000);
    assert.equal(stillAtLimit.ok, false, "only the refunded use was given back, not the whole bucket");
  });

  it("never goes negative when refunding an already-empty bucket repeatedly", async () => {
    const key = `unit-test-refund-empty:${randomUUID()}`;
    await checkRateLimit(key, 5, 60_000);

    await refundRateLimit(key);
    await refundRateLimit(key);
    await refundRateLimit(key);

    const row = await db.rateLimitBucket.findUnique({ where: { key } });
    assert.ok(row);
    assert.ok(row!.count >= 0, "count must never go negative");

    await db.rateLimitBucket.delete({ where: { key } }).catch(() => {});
  });

  it("is a safe no-op for a key that was never created", async () => {
    const key = `unit-test-refund-missing:${randomUUID()}`;
    await assert.doesNotReject(() => refundRateLimit(key));
    const row = await db.rateLimitBucket.findUnique({ where: { key } });
    assert.equal(row, null);
  });
});

describe("hashIdentity", () => {
  it("is case- and whitespace-insensitive, matching the normalisation other identity keys already use", () => {
    assert.equal(hashIdentity("Buyer@Example.com"), hashIdentity("buyer@example.com"));
    assert.equal(hashIdentity("  buyer@example.com  "), hashIdentity("buyer@example.com"));
  });

  it("never returns the raw value itself", () => {
    const identity = "someone@example.com";
    assert.notEqual(hashIdentity(identity), identity);
    assert.match(hashIdentity(identity), /^[a-f0-9]{64}$/, "expected a sha256 hex digest");
  });

  it("different identities hash to different values", () => {
    assert.notEqual(hashIdentity("a@example.com"), hashIdentity("b@example.com"));
  });
});

/**
 * F-322: independent shoppers behind one shared IP (hospital Wi-Fi, a
 * carrier's NAT) must not throttle each other — the tight bucket has to
 * key on IP+identity, not IP alone, while a much looser per-IP backstop
 * still catches an outright flood from one address.
 */
describe("identityRateLimitOrResponse (F-322)", () => {
  after(async () => {
    await resetRateLimits(["unit-test-identity"]);
  });

  it("two different identities behind the same IP each get their own tight bucket", async () => {
    await withEnv({ NODE_ENV: "production", DISABLE_RATE_LIMIT: undefined, VERCEL: "1" }, async () => {
      const route = `unit-test-identity-${randomUUID()}`;
      const ip = "203.0.113.10";
      const requestFromIp = () =>
        new Request("http://localhost/api/account/login", { headers: { "x-vercel-forwarded-for": ip } });

      // Shopper A hits their own tight limit (2/min here).
      for (let i = 0; i < 2; i++) {
        const response = await identityRateLimitOrResponse(requestFromIp(), route, 2, 60_000, {
          identity: "a@example.com",
        });
        assert.equal(response, null, `shopper A attempt ${i + 1} should be allowed`);
      }
      const blockedA = await identityRateLimitOrResponse(requestFromIp(), route, 2, 60_000, {
        identity: "a@example.com",
      });
      assert.ok(blockedA, "shopper A should now be throttled on their own identity bucket");
      assert.equal(blockedA!.status, 429);

      // Shopper B, same IP, different identity — must not be affected by
      // A's bucket being exhausted.
      const responseB = await identityRateLimitOrResponse(requestFromIp(), route, 2, 60_000, {
        identity: "b@example.com",
      });
      assert.equal(responseB, null, "a different identity on the same IP must not be throttled by A's bucket");
    });
  });

  it("the loose IP backstop still blocks an outright flood from one IP, regardless of identity", async () => {
    await withEnv({ NODE_ENV: "production", DISABLE_RATE_LIMIT: undefined, VERCEL: "1" }, async () => {
      const route = `unit-test-identity-backstop-${randomUUID()}`;
      const ip = "203.0.113.20";
      const requestFrom = () => new Request("http://localhost/api/checkout", { headers: { "x-vercel-forwarded-for": ip } });

      // A tiny backstop (3) so the test doesn't need 100+ iterations; a
      // generous per-identity limit (50) so it's the backstop, not the
      // tight bucket, that trips.
      for (let i = 0; i < 3; i++) {
        const response = await identityRateLimitOrResponse(requestFrom(), route, 50, 60_000, {
          identity: `flood-${i}@example.com`,
          backstopLimit: 3,
        });
        assert.equal(response, null, `attempt ${i + 1} should be within the backstop`);
      }

      const blocked = await identityRateLimitOrResponse(requestFrom(), route, 50, 60_000, {
        identity: "flood-final@example.com",
        backstopLimit: 3,
      });
      assert.ok(blocked, "a fresh identity past the IP backstop must still be blocked");
      assert.equal(blocked!.status, 429);
    });
  });
});
