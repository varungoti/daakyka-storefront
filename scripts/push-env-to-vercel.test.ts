import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePlan } from "./push-env-to-vercel.mjs";

/**
 * Pure unit tests for push-env-to-vercel.mjs's computePlan() — the mapping
 * + validation scripts/go-live.mjs's own preflight now calls directly
 * (F-346), so a mapping problem is caught before anything is written to
 * Vercel, not discovered halfway through a `--yes` run.
 */

const VALID_CREDENTIAL_KEY = Buffer.alloc(32, 7).toString("base64");

function baseEnv(overrides = {}) {
  return new Map(
    Object.entries({
      SUPABASE_DATABASE_URL: "postgresql://user:pass@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
      ADMIN_SEED_PASSWORD: "a-strong-unique-password",
      CREDENTIAL_ENCRYPTION_KEY: VALID_CREDENTIAL_KEY,
      NEXT_PUBLIC_SITE_URL: "https://daakyka.com",
      ...overrides,
    }),
  );
}

describe("computePlan required vars", () => {
  it("plans every required var when all are present and valid", () => {
    const { plan, problems } = computePlan(baseEnv());
    assert.deepEqual(
      plan.map((item) => item.prod).sort(),
      ["ADMIN_SEED_PASSWORD", "CREDENTIAL_ENCRYPTION_KEY", "DATABASE_URL", "NEXT_PUBLIC_SITE_URL"].sort(),
    );
    assert.deepEqual(problems, []);
  });

  it("reports a problem for each missing required var", () => {
    const { plan, problems } = computePlan(new Map());
    assert.deepEqual(plan, []);
    assert.equal(problems.length, 4);
    assert.ok(problems.some((p) => p.startsWith("DATABASE_URL:")));
    assert.ok(problems.some((p) => p.startsWith("NEXT_PUBLIC_SITE_URL:")));
  });

  it("rejects a NEXT_PUBLIC_SITE_URL that isn't https", () => {
    const { problems } = computePlan(baseEnv({ NEXT_PUBLIC_SITE_URL: "http://daakyka.com" }));
    assert.ok(problems.some((p) => p.includes("NEXT_PUBLIC_SITE_URL") && p.includes("https")));
  });

  it("rejects a NEXT_PUBLIC_SITE_URL that looks like an SSO-protected Vercel alias (F-007)", () => {
    const { problems } = computePlan(
      baseEnv({ NEXT_PUBLIC_SITE_URL: "https://storefront-varubs-projects.vercel.app" }),
    );
    assert.ok(problems.some((p) => p.includes("NEXT_PUBLIC_SITE_URL") && p.includes("SSO")));
  });
});

describe("computePlan optional vars (F-346)", () => {
  it("does not flag a missing OPENAI_API_KEY or R2 trio as a problem", () => {
    const { plan, problems } = computePlan(baseEnv());
    assert.deepEqual(problems, []);
    assert.equal(plan.some((item) => item.prod === "OPENAI_API_KEY"), false);
    assert.equal(plan.some((item) => item.prod.startsWith("R2_")), false);
  });

  it("plans a present, valid OPENAI_API_KEY", () => {
    const { plan, problems } = computePlan(baseEnv({ OPENAI_API_KEY: "sk-abcdefghij1234567890" }));
    assert.deepEqual(problems, []);
    assert.ok(plan.find((item) => item.prod === "OPENAI_API_KEY"));
  });

  it("flags a present-but-invalid optional value (a stray quote character, F-347)", () => {
    const { plan, problems } = computePlan(baseEnv({ OPENAI_API_KEY: '"sk-not-fully-unquoted' }));
    assert.equal(plan.some((item) => item.prod === "OPENAI_API_KEY"), false);
    assert.ok(problems.some((p) => p.startsWith("OPENAI_API_KEY:") && p.includes("quote")));
  });

  it("prefers R2_ACCESS_KEY_ID over CLOUDFLARE_ACCESS_KEY_ID when both are set", () => {
    const { plan } = computePlan(
      baseEnv({ R2_ACCESS_KEY_ID: "r2-value", CLOUDFLARE_ACCESS_KEY_ID: "cf-value" }),
    );
    const item = plan.find((i) => i.prod === "R2_ACCESS_KEY_ID");
    assert.ok(item);
    assert.equal(item.value, "r2-value");
    assert.equal(item.from, "R2_ACCESS_KEY_ID");
  });

  it("falls back to CLOUDFLARE_ACCESS_KEY_ID, then CLOUDFLARE_ACCESS_KEY, matching src/lib/storage/r2.ts", () => {
    const { plan } = computePlan(baseEnv({ CLOUDFLARE_ACCESS_KEY_ID: "cf-value" }));
    const item = plan.find((i) => i.prod === "R2_ACCESS_KEY_ID");
    assert.ok(item);
    assert.equal(item.value, "cf-value");
    assert.equal(item.from, "CLOUDFLARE_ACCESS_KEY_ID");

    const { plan: plan2 } = computePlan(baseEnv({ CLOUDFLARE_ACCESS_KEY: "cf-legacy-value" }));
    const item2 = plan2.find((i) => i.prod === "R2_ACCESS_KEY_ID");
    assert.ok(item2);
    assert.equal(item2.value, "cf-legacy-value");
    assert.equal(item2.from, "CLOUDFLARE_ACCESS_KEY");
  });
});

describe("computePlan ADMIN_SEED_PASSWORD / CREDENTIAL_ENCRYPTION_KEY / DATABASE_URL validation", () => {
  it("rejects a too-short seed password", () => {
    const { problems } = computePlan(baseEnv({ ADMIN_SEED_PASSWORD: "short" }));
    assert.ok(problems.some((p) => p.startsWith("ADMIN_SEED_PASSWORD:")));
  });

  it("rejects a CREDENTIAL_ENCRYPTION_KEY that doesn't decode to 32 bytes", () => {
    const { problems } = computePlan(baseEnv({ CREDENTIAL_ENCRYPTION_KEY: "too-short" }));
    assert.ok(problems.some((p) => p.startsWith("CREDENTIAL_ENCRYPTION_KEY:")));
  });

  it("rejects a DATABASE_URL (from SUPABASE_DATABASE_URL) pointing at localhost", () => {
    const { problems } = computePlan(
      baseEnv({ SUPABASE_DATABASE_URL: "postgresql://user:pass@localhost:5432/db" }),
    );
    assert.ok(problems.some((p) => p.startsWith("DATABASE_URL:") && p.includes("localhost")));
  });
});
