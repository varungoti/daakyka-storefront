import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { setNodeEnv } from "../helpers/env";
import { GET as getProducts } from "@/app/api/products/route";
import { GET as getHealth } from "@/app/api/health/route";
import { POST as postNewsletter } from "@/app/api/newsletter/subscribe/route";
import { POST as postLogin } from "@/app/api/auth/login/route";
import { verifyPassword } from "@/lib/auth/password";
import { DEFAULT_ADMIN_SEED_EMAIL } from "@/lib/auth/seed-defaults";
import { db } from "@/lib/db";
import { GET as getCronJourneys } from "@/app/api/cron/journeys/route";
import { GET as getCronCampaigns } from "@/app/api/cron/campaigns/route";
import { POST as postProductView } from "@/app/api/analytics/product-view/route";
import { POST as postContact } from "@/app/api/contact/route";
import { POST as postBulkOrder } from "@/app/api/bulk-orders/route";
import { POST as postShopifyWebhook } from "@/app/api/webhooks/shopify/orders/route";
import { checkRateLimit, resetRateLimits } from "@/lib/security/rate-limit";

describe("API integration", () => {
  describe("GET /api/health", () => {
    // F4 (docs/audit-2026-09-19/security.md): unauthenticated callers now
    // get only the DB-connectivity liveness signal, not the catalog
    // source or per-provider integration statuses. Calling the route
    // handler directly here (not through a real Next.js request) means
    // requireAdminPermission()'s getSession() fails closed (cookies()
    // throws outside a request scope, caught, returns null) — the same
    // harness limitation documented in
    // tests/integration/admin-auth.test.ts — which conveniently is
    // exactly the "no session" case this test wants to exercise. The
    // authenticated admin -> full-detail branch is not exercisable this
    // way; see src/app/api/health/route.ts's doc comment.
    it("returns only the minimal liveness shape for an unauthenticated caller", async () => {
      const response = await getHealth();
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        status: string;
        timestamp: string;
        catalog?: string;
        integrations?: { provider: string; status: string }[];
      };
      assert.equal(body.status, "ok");
      assert.ok(typeof body.timestamp === "string" && body.timestamp.length > 0);
      assert.equal(body.catalog, undefined, "catalog source must not leak to an unauthenticated caller");
      assert.equal(
        body.integrations,
        undefined,
        "integration statuses must not leak to an unauthenticated caller",
      );
    });
  });
  describe("GET /api/products", () => {
    it("returns a product list", async () => {
      const response = await getProducts();
      assert.equal(response.status, 200);
      const body = (await response.json()) as { products: unknown[] };
      assert.ok(Array.isArray(body.products));
      assert.ok(body.products.length > 0);
    });
  });

  describe("POST /api/newsletter/subscribe", () => {
    it("rejects missing consent", async () => {
      const response = await postNewsletter(
        new Request("http://localhost/api/newsletter/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "test@example.com", consentGiven: false }),
        }),
      );
      assert.equal(response.status, 400);
    });

    it("accepts valid subscription", async () => {
      const email = `integration-${Date.now()}@example.com`;
      const response = await postNewsletter(
        new Request("http://localhost/api/newsletter/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, consentGiven: true, source: "integration-test" }),
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { id: string };
      assert.ok(body.id);
    });
  });

  describe("POST /api/auth/login", () => {
    it("rejects invalid credentials", async () => {
      const response = await postLogin(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "bad@example.com", password: "wrongpassword" }),
        }),
      );
      assert.equal(response.status, 401);
    });

    it("verifies seed admin password hash", async (t) => {
      // prisma/seed.ts generates a random password when ADMIN_SEED_PASSWORD
      // isn't set, so there's nothing to verify against in that case —
      // skip rather than guess at a since-removed hardcoded default.
      const password = process.env.ADMIN_SEED_PASSWORD;
      if (!password) {
        t.skip("ADMIN_SEED_PASSWORD not set in this environment");
        return;
      }
      const email = (process.env.ADMIN_SEED_EMAIL ?? DEFAULT_ADMIN_SEED_EMAIL).toLowerCase();
      const user = await db.user.findUnique({ where: { email } });
      assert.ok(user, "seed admin user must exist — run npm run db:seed");
      const valid = await verifyPassword(password, user.passwordHash);
      assert.equal(valid, true);
    });
  });

  describe("POST /api/analytics/product-view", () => {
    it("records a product view", async () => {
      const response = await postProductView(
        new Request("http://localhost/api/analytics/product-view", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productHandle: "v-neck-top-lilac",
            productName: "V-Neck Top Lilac",
            sessionId: "integration-test",
          }),
        }),
      );
      assert.equal(response.status, 200);
    });
  });

  describe("cron auth", () => {
    const originalSecret = process.env.CRON_SECRET;
    const originalNodeEnv = process.env.NODE_ENV;

    after(() => {
      if (originalSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = originalSecret;
      setNodeEnv(originalNodeEnv);
    });

    it("rejects cron without bearer when CRON_SECRET is set", async () => {
      process.env.CRON_SECRET = "test-cron-secret";
      setNodeEnv("production");
      const response = await getCronJourneys(new Request("http://localhost/api/cron/journeys"));
      assert.equal(response.status, 401);
    });

    it("accepts cron with valid bearer", async () => {
      process.env.CRON_SECRET = "test-cron-secret";
      setNodeEnv("production");
      const response = await getCronJourneys(
        new Request("http://localhost/api/cron/journeys", {
          headers: { Authorization: "Bearer test-cron-secret" },
        }),
      );
      assert.equal(response.status, 200);
    });

    it("accepts campaigns cron with valid bearer", async () => {
      process.env.CRON_SECRET = "test-cron-secret";
      setNodeEnv("production");
      const response = await getCronCampaigns(
        new Request("http://localhost/api/cron/campaigns", {
          headers: { Authorization: "Bearer test-cron-secret" },
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { ok: boolean; processed: number };
      assert.equal(body.ok, true);
      assert.ok(typeof body.processed === "number");
    });
  });

  describe("POST /api/contact", () => {
    it("rejects short messages", async () => {
      const response = await postContact(
        new Request("http://localhost/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Test User",
            email: "contact-test@example.com",
            message: "short",
          }),
        }),
      );
      assert.equal(response.status, 400);
    });

    it("accepts valid enquiry", async () => {
      const response = await postContact(
        new Request("http://localhost/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Integration Test",
            email: `contact-${Date.now()}@example.com`,
            message: "We need institutional uniforms for our hospital team.",
            type: "INSTITUTIONAL",
          }),
        }),
      );
      assert.equal(response.status, 200);
    });

    it("rejects oversized JSON payloads", async () => {
      const response = await postContact(
        new Request("http://localhost/api/contact", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "content-length": String(70 * 1024),
          },
          body: JSON.stringify({ name: "x".repeat(70 * 1024) }),
        }),
      );
      assert.equal(response.status, 413);
    });
  });

  describe("POST /api/bulk-orders", () => {
    it("requires consent", async () => {
      const response = await postBulkOrder(
        new Request("http://localhost/api/bulk-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organization: "Test Hospital",
            contactPerson: "Dr Test",
            email: "bulk@example.com",
            phone: "9876543210",
            consentGiven: false,
          }),
        }),
      );
      assert.equal(response.status, 400);
    });

    it("accepts valid bulk enquiry", async () => {
      const response = await postBulkOrder(
        new Request("http://localhost/api/bulk-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organization: "Test Hospital",
            contactPerson: "Dr Test",
            email: `bulk-${Date.now()}@example.com`,
            phone: "9876543210",
            consentGiven: true,
          }),
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { id: string };
      await db.bulkOrderLead.delete({ where: { id: body.id } }).catch(() => {});
    });

    // Phase C7: organisationType + categoryInterest are additive fields —
    // both directions (present and omitted) must keep working.
    it("accepts and stores organizationType and categoryInterest when provided", async () => {
      const response = await postBulkOrder(
        new Request("http://localhost/api/bulk-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organization: "Test School",
            contactPerson: "Ms Test",
            email: `bulk-org-type-${Date.now()}@example.com`,
            phone: "9876543210",
            consentGiven: true,
            organizationType: "SCHOOL",
            categoryInterest: ["School Uniforms", "Sports Uniforms"],
          }),
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { id: string };

      const stored = await db.bulkOrderLead.findUnique({ where: { id: body.id } });
      assert.ok(stored, "expected the lead to be persisted");
      assert.equal(stored?.organizationType, "SCHOOL");
      assert.deepEqual(stored?.categoryInterest, ["School Uniforms", "Sports Uniforms"]);

      await db.bulkOrderLead.delete({ where: { id: body.id } });
    });

    it("still accepts an enquiry that omits organizationType/categoryInterest (backward compatible)", async () => {
      const response = await postBulkOrder(
        new Request("http://localhost/api/bulk-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organization: "Legacy Client Co",
            contactPerson: "Mr Legacy",
            email: `bulk-legacy-${Date.now()}@example.com`,
            phone: "9876543210",
            consentGiven: true,
          }),
        }),
      );
      assert.equal(response.status, 200);
      const body = (await response.json()) as { id: string };

      const stored = await db.bulkOrderLead.findUnique({ where: { id: body.id } });
      assert.ok(stored, "expected the lead to be persisted");
      assert.equal(stored?.organizationType, null);
      assert.deepEqual(stored?.categoryInterest, []);

      await db.bulkOrderLead.delete({ where: { id: body.id } });
    });
  });

  describe("Shopify orders webhook", () => {
    const originalSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
    const originalNodeEnv = process.env.NODE_ENV;

    after(() => {
      if (originalSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
      else process.env.SHOPIFY_WEBHOOK_SECRET = originalSecret;
      setNodeEnv(originalNodeEnv);
    });

    it("rejects unsigned payload when webhook secret is set", async () => {
      process.env.SHOPIFY_WEBHOOK_SECRET = "test-webhook-secret";
      setNodeEnv("production");
      const response = await postShopifyWebhook(
        new Request("http://localhost/api/webhooks/shopify/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: 999001, email: "webhook@example.com" }),
        }),
      );
      assert.equal(response.status, 401);
    });

    function signedWebhookRequest(body: string, headers: Record<string, string> = {}) {
      const hmac = createHmac("sha256", "test-webhook-secret").update(body, "utf8").digest("base64");
      return new Request("http://localhost/api/webhooks/shopify/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-shopify-hmac-sha256": hmac,
          "x-shopify-topic": "orders/create",
          ...headers,
        },
        body,
      });
    }

    it("rejects a validly-signed payload with an unrecognized topic", async () => {
      process.env.SHOPIFY_WEBHOOK_SECRET = "test-webhook-secret";
      setNodeEnv("production");
      const body = JSON.stringify({ id: 999002, email: "webhook@example.com" });
      const response = await postShopifyWebhook(
        signedWebhookRequest(body, { "x-shopify-topic": "customers/data_request" }),
      );
      assert.equal(response.status, 400);
    });

    it("rejects a validly-signed payload from an unexpected shop domain", async () => {
      const originalDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
      process.env.SHOPIFY_WEBHOOK_SECRET = "test-webhook-secret";
      process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "daakyka.myshopify.com";
      setNodeEnv("production");
      try {
        const body = JSON.stringify({ id: 999003, email: "webhook@example.com" });
        const response = await postShopifyWebhook(
          signedWebhookRequest(body, { "x-shopify-shop-domain": "attacker-store.myshopify.com" }),
        );
        assert.equal(response.status, 401);
      } finally {
        if (originalDomain === undefined) delete process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
        else process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = originalDomain;
      }
    });

    it("accepts a validly-signed payload with a recognized topic and matching shop domain", async () => {
      const originalDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
      process.env.SHOPIFY_WEBHOOK_SECRET = "test-webhook-secret";
      process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = "daakyka.myshopify.com";
      setNodeEnv("production");
      try {
        const body = JSON.stringify({ id: 999004, email: "webhook-ok@example.com" });
        const response = await postShopifyWebhook(
          signedWebhookRequest(body, { "x-shopify-shop-domain": "daakyka.myshopify.com" }),
        );
        assert.equal(response.status, 200);
      } finally {
        if (originalDomain === undefined) delete process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
        else process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN = originalDomain;
      }
    });
  });

  describe("rate limiting helper", () => {
    after(async () => {
      await resetRateLimits(["test-route", "newsletter", "contact", "bulk-orders"]);
    });

    it("returns retryAfter when bucket is full", async () => {
      await resetRateLimits(["test-route", "newsletter", "contact", "bulk-orders"]);
      // Prefixed so the describe's own after() reset reaches it, and
      // uuid-suffixed so a leftover row from an earlier run inside the
      // 60s window can't pre-fill the bucket under test. The previous
      // fixed "integration:test" key matched neither and leaked.
      const key = `test-route:integration-${randomUUID()}`;
      await checkRateLimit(key, 1, 60_000);
      const blocked = await checkRateLimit(key, 1, 60_000);
      assert.equal(blocked.ok, false);
    });
  });
});
