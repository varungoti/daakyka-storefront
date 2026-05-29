import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isIndexingAllowed, validateEnv } from "@/lib/env";
import {
  checkRateLimit,
  getClientIp,
  resetRateLimits,
} from "@/lib/security/rate-limit";

describe("env validation", () => {
  it("allows indexing by default in non-preview environments", () => {
    const originalAllow = process.env.NEXT_PUBLIC_ALLOW_INDEXING;
    const originalVercel = process.env.VERCEL_ENV;
    delete process.env.NEXT_PUBLIC_ALLOW_INDEXING;
    delete process.env.VERCEL_ENV;
    assert.equal(isIndexingAllowed(), true);
    if (originalAllow !== undefined) process.env.NEXT_PUBLIC_ALLOW_INDEXING = originalAllow;
    if (originalVercel !== undefined) process.env.VERCEL_ENV = originalVercel;
  });

  it("blocks indexing when NEXT_PUBLIC_ALLOW_INDEXING=false", () => {
    const original = process.env.NEXT_PUBLIC_ALLOW_INDEXING;
    process.env.NEXT_PUBLIC_ALLOW_INDEXING = "false";
    assert.equal(isIndexingAllowed(), false);
    if (original === undefined) delete process.env.NEXT_PUBLIC_ALLOW_INDEXING;
    else process.env.NEXT_PUBLIC_ALLOW_INDEXING = original;
  });

  it("does not throw validateEnv in development", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    assert.doesNotThrow(() => validateEnv());
    process.env.NODE_ENV = originalNodeEnv;
  });
});

describe("rate limiting", () => {
  it("extracts client IP from x-forwarded-for", () => {
    const request = new Request("http://localhost/api/test", {
      headers: { "x-forwarded-for": "203.0.113.1, 70.41.3.18" },
    });
    assert.equal(getClientIp(request), "203.0.113.1");
  });

  it("blocks after limit is exceeded", () => {
    resetRateLimits();
    const key = "test-route:127.0.0.1";
    assert.equal(checkRateLimit(key, 2, 60_000).ok, true);
    assert.equal(checkRateLimit(key, 2, 60_000).ok, true);
    const blocked = checkRateLimit(key, 2, 60_000);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.ok(blocked.retryAfter >= 1);
    }
  });
});
