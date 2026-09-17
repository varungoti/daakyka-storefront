import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isIndexingAllowed, validateEnv } from "@/lib/env";
import {
  checkRateLimit,
  getClientIp,
  resetRateLimits,
} from "@/lib/security/rate-limit";
import { setNodeEnv, withEnv } from "../../tests/helpers/env";

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
    setNodeEnv("development");
    assert.doesNotThrow(() => validateEnv());
    setNodeEnv(originalNodeEnv);
  });

  // A full set of otherwise-valid production env vars, used as the base
  // for the strict-mode tests below so each one only varies the field
  // it's actually testing.
  const validProductionEnv = {
    VERCEL_ENV: "production",
    AUTH_SECRET: "a".repeat(32),
    DATABASE_URL: "postgresql://user:pass@host:5432/db",
    CRON_SECRET: "cron-secret",
    ADMIN_SEED_PASSWORD: "a-genuinely-unique-password-123",
    NEXT_PUBLIC_SITE_URL: "https://daakyka.com",
    NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: undefined,
    NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN: undefined,
    BREVO_API_KEY: undefined,
    BREVO_FROM_EMAIL: undefined,
  };

  it("does not throw validateEnv in production with a complete, safe config", async () => {
    await withEnv(validProductionEnv, () => {
      assert.doesNotThrow(() => validateEnv());
    });
  });

  it("throws in production when ADMIN_SEED_PASSWORD is unset", async () => {
    await withEnv({ ...validProductionEnv, ADMIN_SEED_PASSWORD: undefined }, () => {
      assert.throws(() => validateEnv(), /ADMIN_SEED_PASSWORD/);
    });
  });

  it("throws in production when ADMIN_SEED_PASSWORD is a known default", async () => {
    await withEnv({ ...validProductionEnv, ADMIN_SEED_PASSWORD: "Daakyka@2026" }, () => {
      assert.throws(() => validateEnv(), /ADMIN_SEED_PASSWORD/);
    });
  });

  it("throws in production when NEXT_PUBLIC_SITE_URL is missing or not https", async () => {
    await withEnv({ ...validProductionEnv, NEXT_PUBLIC_SITE_URL: undefined }, () => {
      assert.throws(() => validateEnv(), /NEXT_PUBLIC_SITE_URL/);
    });
    await withEnv({ ...validProductionEnv, NEXT_PUBLIC_SITE_URL: "http://daakyka.com" }, () => {
      assert.throws(() => validateEnv(), /NEXT_PUBLIC_SITE_URL/);
    });
  });

  it("throws in production when BREVO_API_KEY is set without BREVO_FROM_EMAIL", async () => {
    await withEnv(
      { ...validProductionEnv, BREVO_API_KEY: "test-key", BREVO_FROM_EMAIL: undefined },
      () => {
        assert.throws(() => validateEnv(), /BREVO_FROM_EMAIL/);
      },
    );
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
