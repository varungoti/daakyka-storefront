import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { shouldUseSecureSessionCookie } from "@/lib/auth/session-cookie";
import { withEnv } from "../../../tests/helpers/env";

describe("shouldUseSecureSessionCookie", () => {
  const original = { ...process.env };

  beforeEach(() => {
    delete process.env.COOKIE_SECURE;
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("defaults to non-secure when site URL is unset", () => {
    assert.equal(shouldUseSecureSessionCookie(), false);
  });

  it("uses secure cookies for https site URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.daakyka.com";
    assert.equal(shouldUseSecureSessionCookie(), true);
  });

  it("uses non-secure cookies for http localhost", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    assert.equal(shouldUseSecureSessionCookie(), false);
  });

  it("honors COOKIE_SECURE=false override outside production/Vercel", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://staging.daakyka.com";
    process.env.COOKIE_SECURE = "false";
    assert.equal(shouldUseSecureSessionCookie(), false);
  });

  it("is always secure in production, even with COOKIE_SECURE=false and no site URL", async () => {
    await withEnv(
      { NODE_ENV: "production", COOKIE_SECURE: "false", NEXT_PUBLIC_SITE_URL: undefined },
      () => {
        assert.equal(shouldUseSecureSessionCookie(), true);
      },
    );
  });

  it("is always secure on Vercel, even with COOKIE_SECURE=false and an http site URL", async () => {
    await withEnv(
      {
        VERCEL: "1",
        COOKIE_SECURE: "false",
        NEXT_PUBLIC_SITE_URL: "http://misconfigured.example.com",
      },
      () => {
        assert.equal(shouldUseSecureSessionCookie(), true);
      },
    );
  });
});
