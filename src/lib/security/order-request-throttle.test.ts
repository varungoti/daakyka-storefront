import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { orderRequestThrottleOrResponse } from "@/lib/security/order-request-throttle";

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
 */
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
      const result = await orderRequestThrottleOrResponse(email, phone);
      assert.equal(result, null, `expected attempt ${attempt} to be allowed`);
    }

    const blocked = await orderRequestThrottleOrResponse(email, phone);
    assert.ok(blocked, "expected the 6th request to be blocked");
    assert.equal(blocked!.status, 429);
    assert.ok(blocked!.headers.get("Retry-After"), "expected a Retry-After header");
    const body = (await blocked!.json()) as { error: string };
    assert.match(body.error, /too many/i);
  });

  it("treats email case-insensitively (Buyer@Example.com and buyer@example.com share a bucket)", async () => {
    const uniquePart = randomUUID();
    const mixedCaseEmail = `Case-Test-${uniquePart}@Example.com`;
    const lowerCaseEmail = mixedCaseEmail.toLowerCase();
    createdKeys.push(`order-request:email:${lowerCaseEmail}`);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const result = await orderRequestThrottleOrResponse(
        attempt % 2 === 0 ? mixedCaseEmail : lowerCaseEmail,
        undefined,
      );
      assert.equal(result, null, `expected attempt ${attempt} to be allowed`);
    }

    const blocked = await orderRequestThrottleOrResponse(mixedCaseEmail, undefined);
    assert.ok(blocked, "the differently-cased email should still hit the same bucket");
    assert.equal(blocked!.status, 429);
  });

  it("also throttles on phone alone, even with a fresh email every attempt", async () => {
    const phone = `phone-${randomUUID()}`;
    createdKeys.push(`order-request:phone:${phone}`);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const email = `phone-throttle-${randomUUID()}@example.com`;
      createdKeys.push(`order-request:email:${email.toLowerCase()}`);
      const result = await orderRequestThrottleOrResponse(email, phone);
      assert.equal(result, null, `expected attempt ${attempt} to be allowed`);
    }

    const finalEmail = `phone-throttle-${randomUUID()}@example.com`;
    createdKeys.push(`order-request:email:${finalEmail.toLowerCase()}`);
    const blocked = await orderRequestThrottleOrResponse(finalEmail, phone);
    assert.ok(blocked, "expected the phone-based limit to block even with a brand-new email");
    assert.equal(blocked!.status, 429);
  });

  it("does not block a completely fresh email/phone pair", async () => {
    const email = `fresh-${randomUUID()}@example.com`;
    const phone = `phone-${randomUUID()}`;
    createdKeys.push(`order-request:email:${email.toLowerCase()}`, `order-request:phone:${phone}`);

    const result = await orderRequestThrottleOrResponse(email, phone);
    assert.equal(result, null);
  });
});
