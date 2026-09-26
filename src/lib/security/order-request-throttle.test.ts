import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  orderRequestThrottleOrResponse,
  releaseOrderRequestThrottle,
} from "@/lib/security/order-request-throttle";
import { withEnv } from "../../../tests/helpers/env";

/**
 * Release-hardening Finding B: an IP-independent abuse guard for the
 * unpaid ORDER_REQUEST checkout fallback (see src/app/api/checkout/route.ts,
 * which calls this before createOrderFromCart whenever Razorpay isn't
 * configured, so a throttled request never decrements stock). Tested
 * directly here — rather than through the full checkout route, which would
 * either take the ORDER_REQUEST fallback anyway or, with real-looking
 * Razorpay keys, reach out to Razorpay's live API — so this stays fast,
 * isolated, and independent of any payment configuration.
 *
 * Each test uses its own randomised email/phone "identity" and cleans up
 * exactly the RateLimitBucket rows it created, so this can run alongside
 * other DB-backed rate-limit tests (src/lib/security/rate-limit.test.ts)
 * without interference.
 *
 * `blankRequest()` has no x-vercel-forwarded-for/x-real-ip/x-forwarded-for
 * headers set in a trusted way (these tests don't run under
 * VERCEL=1/TRUST_PROXY_HEADERS=1), so getClientIp() resolves to null and
 * the F-118 IP-cap branch is a no-op here — exactly the identity-only
 * behaviour these tests assert. The IP cap itself is covered separately
 * below, under an explicit VERCEL=1 env.
 */
function blankRequest(): Request {
  return new Request("http://localhost/api/checkout");
}

describe("orderRequestThrottleOrResponse", () => {
  const createdKeys: string[] = [];

  after(async () => {
    if (createdKeys.length > 0) {
      await db.rateLimitBucket.deleteMany({ where: { key: { in: createdKeys } } }).catch(() => {});
    }
  });

  it("allows the first 5 requests for a given email, then blocks the 6th with a 429 and Retry-After", async () => {
    const email = `throttle-unit-${randomUUID()}@example.com`;
    const phone = `phone-${randomUUID()}`;
    createdKeys.push(`order-request:email:${email.toLowerCase()}`, `order-request:phone:${phone}`);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = await orderRequestThrottleOrResponse(blankRequest(), email, phone);
      assert.equal(result.response, null, `expected attempt ${attempt} to be allowed`);
      assert.ok(result.consumedKeys.length > 0, "a passing attempt should report what it consumed");
    }

    const blocked = await orderRequestThrottleOrResponse(blankRequest(), email, phone);
    assert.ok(blocked.response, "expected the 6th request to be blocked");
    assert.equal(blocked.response!.status, 429);
    assert.ok(blocked.response!.headers.get("Retry-After"), "expected a Retry-After header");
    const body = (await blocked.response!.json()) as { error: string };
    assert.match(body.error, /too many/i);
  });

  it("treats email case-insensitively (Buyer@Example.com and buyer@example.com share a bucket)", async () => {
    const uniquePart = randomUUID();
    const mixedCaseEmail = `Case-Test-${uniquePart}@Example.com`;
    const lowerCaseEmail = mixedCaseEmail.toLowerCase();
    createdKeys.push(`order-request:email:${lowerCaseEmail}`);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = await orderRequestThrottleOrResponse(
        blankRequest(),
        attempt % 2 === 0 ? mixedCaseEmail : lowerCaseEmail,
        undefined,
      );
      assert.equal(result.response, null, `expected attempt ${attempt} to be allowed`);
    }

    const blocked = await orderRequestThrottleOrResponse(blankRequest(), mixedCaseEmail, undefined);
    assert.ok(blocked.response, "the differently-cased email should still hit the same bucket");
    assert.equal(blocked.response!.status, 429);
  });

  it("also throttles on phone alone, even with a fresh email every attempt", async () => {
    const phone = `phone-${randomUUID()}`;
    createdKeys.push(`order-request:phone:${phone}`);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const email = `phone-throttle-${randomUUID()}@example.com`;
      createdKeys.push(`order-request:email:${email.toLowerCase()}`);
      const result = await orderRequestThrottleOrResponse(blankRequest(), email, phone);
      assert.equal(result.response, null, `expected attempt ${attempt} to be allowed`);
    }

    const finalEmail = `phone-throttle-${randomUUID()}@example.com`;
    createdKeys.push(`order-request:email:${finalEmail.toLowerCase()}`);
    const blocked = await orderRequestThrottleOrResponse(blankRequest(), finalEmail, phone);
    assert.ok(blocked.response, "expected the phone-based limit to block even with a brand-new email");
    assert.equal(blocked.response!.status, 429);
  });

  it("does not block a completely fresh email/phone pair", async () => {
    const email = `fresh-${randomUUID()}@example.com`;
    const phone = `phone-${randomUUID()}`;
    createdKeys.push(`order-request:email:${email.toLowerCase()}`, `order-request:phone:${phone}`);

    const result = await orderRequestThrottleOrResponse(blankRequest(), email, phone);
    assert.equal(result.response, null);
  });

  // F-123: a shopper resubmitting a broken cart (out of stock, an invalid
  // variant, a bad discount code — never abuse) must not be a step closer
  // to a 429 than before they tried.
  describe("releaseOrderRequestThrottle (F-123)", () => {
    it("gives back a consumed key, so 5 failed-then-released attempts don't exhaust the limit", async () => {
      const email = `throttle-refund-${randomUUID()}@example.com`;
      const key = `order-request:email:${email.toLowerCase()}`;
      createdKeys.push(key);

      // Simulate 10 submit attempts that all fail for a shopper-correctable
      // reason (out of stock, say) and are released every time — none of
      // them should ever count toward the 5/hour limit.
      for (let attempt = 1; attempt <= 10; attempt++) {
        const result = await orderRequestThrottleOrResponse(blankRequest(), email, undefined);
        assert.equal(result.response, null, `attempt ${attempt} should not be throttled`);
        await releaseOrderRequestThrottle(result.consumedKeys);
      }

      // The bucket must still have room: one more (unreleased) attempt
      // succeeds, and it must not have been silently blocked by the
      // released attempts above.
      const final = await orderRequestThrottleOrResponse(blankRequest(), email, undefined);
      assert.equal(final.response, null, "released attempts must not count toward the limit");
    });

    it("released keys can still be re-consumed up to the real limit afterwards", async () => {
      const email = `throttle-refund-then-block-${randomUUID()}@example.com`;
      const key = `order-request:email:${email.toLowerCase()}`;
      createdKeys.push(key);

      const first = await orderRequestThrottleOrResponse(blankRequest(), email, undefined);
      assert.equal(first.response, null);
      await releaseOrderRequestThrottle(first.consumedKeys);

      // 5 genuine (unreleased) attempts now consume the real limit.
      for (let attempt = 1; attempt <= 5; attempt++) {
        const result = await orderRequestThrottleOrResponse(blankRequest(), email, undefined);
        assert.equal(result.response, null, `attempt ${attempt} should be allowed`);
      }

      const blocked = await orderRequestThrottleOrResponse(blankRequest(), email, undefined);
      assert.ok(blocked.response, "the 6th genuine attempt should still be blocked as normal");
      assert.equal(blocked.response!.status, 429);
    });

    it("is a safe no-op for an empty key list", async () => {
      await assert.doesNotReject(() => releaseOrderRequestThrottle([]));
    });
  });

  // F-118: a script that mints a fresh random email/phone every request
  // defeats the identity keys above on their own — the IP-keyed hard cap
  // is what still bounds it. Exercised under an explicit trusted-IP env so
  // getClientIp() actually resolves an IP (see blankRequest()'s doc
  // comment above for why the other tests in this file don't hit this
  // branch at all).
  describe("IP hard cap (F-118)", () => {
    it("blocks further ORDER_REQUEST attempts from one IP after 20, even with a fresh email and phone every time", async () => {
      await withEnv({ NODE_ENV: "production", DISABLE_RATE_LIMIT: undefined, VERCEL: "1" }, async () => {
        const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
        const ipKey = `order-request:ip:${ip}`;
        createdKeys.push(ipKey);
        const requestFromIp = () =>
          new Request("http://localhost/api/checkout", { headers: { "x-vercel-forwarded-for": ip } });

        for (let attempt = 1; attempt <= 20; attempt++) {
          const email = `ip-cap-${randomUUID()}@example.com`;
          createdKeys.push(`order-request:email:${email.toLowerCase()}`);
          const result = await orderRequestThrottleOrResponse(requestFromIp(), email, undefined);
          assert.equal(result.response, null, `attempt ${attempt} (fresh identity) should still be allowed`);
        }

        const finalEmail = `ip-cap-${randomUUID()}@example.com`;
        createdKeys.push(`order-request:email:${finalEmail.toLowerCase()}`);
        const blocked = await orderRequestThrottleOrResponse(requestFromIp(), finalEmail, undefined);
        assert.ok(blocked.response, "the 21st attempt from the same IP must be blocked despite a fresh identity");
        assert.equal(blocked.response!.status, 429);
      });
    });

    it("a different IP gets its own independent bucket", async () => {
      await withEnv({ NODE_ENV: "production", DISABLE_RATE_LIMIT: undefined, VERCEL: "1" }, async () => {
        const ipA = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
        const ipB = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
        createdKeys.push(`order-request:ip:${ipA}`, `order-request:ip:${ipB}`);
        const emailA = `ip-independent-a-${randomUUID()}@example.com`;
        const emailB = `ip-independent-b-${randomUUID()}@example.com`;
        createdKeys.push(`order-request:email:${emailA.toLowerCase()}`, `order-request:email:${emailB.toLowerCase()}`);

        const resultA = await orderRequestThrottleOrResponse(
          new Request("http://localhost/api/checkout", { headers: { "x-vercel-forwarded-for": ipA } }),
          emailA,
          undefined,
        );
        const resultB = await orderRequestThrottleOrResponse(
          new Request("http://localhost/api/checkout", { headers: { "x-vercel-forwarded-for": ipB } }),
          emailB,
          undefined,
        );
        assert.equal(resultA.response, null);
        assert.equal(resultB.response, null);
      });
    });
  });
});
