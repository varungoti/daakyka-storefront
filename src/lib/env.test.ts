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

// F1 (docs/audit-2026-09-19/security.md): getClientIp() must never
// resolve to a value the client itself can pick. These cover the
// trusted-header precedence and the off-Vercel default-deny behavior;
// the end-to-end "rotating a spoofed X-Forwarded-For can't reset the
// rate-limit bucket" regression lives in
// src/lib/security/rate-limit.test.ts alongside the rest of the bucket
// behavior.
describe("getClientIp (trusted-proxy resolution)", () => {
  it("returns null with no trusted platform/proxy signal configured, even with a spoofed x-forwarded-for present (plain next dev/self-host default)", async () => {
    await withEnv({ VERCEL: undefined, TRUST_PROXY_HEADERS: undefined }, () => {
      const request = new Request("http://localhost/api/test", {
        headers: { "x-forwarded-for": "203.0.113.1, 70.41.3.18" },
      });
      assert.equal(getClientIp(request), null);
    });
  });

  it("returns null off Vercel even when every forwarded header is present, without an explicit opt-in", async () => {
    await withEnv({ VERCEL: undefined, TRUST_PROXY_HEADERS: undefined }, () => {
      const request = new Request("http://localhost/api/test", {
        headers: {
          "x-forwarded-for": "1.2.3.4",
          "x-real-ip": "5.6.7.8",
          "x-vercel-forwarded-for": "9.9.9.9",
        },
      });
      assert.equal(getClientIp(request), null);
    });
  });

  it("trusts x-vercel-forwarded-for first when VERCEL is set, ignoring a spoofed x-forwarded-for", async () => {
    await withEnv({ VERCEL: "1" }, () => {
      const request = new Request("http://localhost/api/test", {
        headers: {
          "x-vercel-forwarded-for": "203.0.113.9",
          "x-forwarded-for": "10.0.0.1",
          "x-real-ip": "10.0.0.2",
        },
      });
      assert.equal(getClientIp(request), "203.0.113.9");
    });
  });

  it("falls back to x-real-ip when x-vercel-forwarded-for is absent, on Vercel", async () => {
    await withEnv({ VERCEL: "1" }, () => {
      const request = new Request("http://localhost/api/test", {
        headers: { "x-real-ip": "203.0.113.10", "x-forwarded-for": "10.0.0.1" },
      });
      assert.equal(getClientIp(request), "203.0.113.10");
    });
  });

  it("falls back to the RIGHTMOST x-forwarded-for hop (not the client-controlled leftmost one) on Vercel", async () => {
    await withEnv({ VERCEL: "1" }, () => {
      const request = new Request("http://localhost/api/test", {
        headers: { "x-forwarded-for": "attacker-spoofed-hop, 203.0.113.11" },
      });
      assert.equal(getClientIp(request), "203.0.113.11");
    });
  });

  it("trusts the rightmost x-forwarded-for hop off Vercel when TRUST_PROXY_HEADERS=1 is explicitly set", async () => {
    await withEnv({ VERCEL: undefined, TRUST_PROXY_HEADERS: "1" }, () => {
      const request = new Request("http://localhost/api/test", {
        headers: { "x-forwarded-for": "attacker-spoofed-hop, 203.0.113.12" },
      });
      assert.equal(getClientIp(request), "203.0.113.12");
    });
  });

  it("does not trust proxy headers off Vercel just because TRUST_PROXY_HEADERS is set to a falsy-looking string", async () => {
    await withEnv({ VERCEL: undefined, TRUST_PROXY_HEADERS: "0" }, () => {
      const request = new Request("http://localhost/api/test", {
        headers: { "x-forwarded-for": "1.2.3.4" },
      });
      assert.equal(getClientIp(request), null);
    });
  });
});

describe("rate limiting", () => {
  it("blocks after limit is exceeded", async () => {
    await resetRateLimits();
    const key = "test-route:127.0.0.1";
    assert.equal((await checkRateLimit(key, 2, 60_000)).ok, true);
    assert.equal((await checkRateLimit(key, 2, 60_000)).ok, true);
    const blocked = await checkRateLimit(key, 2, 60_000);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) {
      assert.ok(blocked.retryAfter >= 1);
    }
  });
});
