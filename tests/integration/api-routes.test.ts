import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
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
import { GET as getCart, POST as postCart } from "@/app/api/cart/route";
import { POST as postShopifyWebhook } from "@/app/api/webhooks/shopify/orders/route";
import { checkRateLimit, resetRateLimits } from "@/lib/security/rate-limit";

describe("API integration", () => {
  describe("GET /api/health", () => {
    it("returns ok with integration statuses", async () => {
      const response = await getHealth();
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        status: string;
        catalog: string;
        integrations: { provider: string; status: string }[];
      };
      assert.equal(body.status, "ok");
      assert.ok(["db", "seed"].includes(body.catalog));
      assert.ok(body.integrations.length >= 4);
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

  describe("cart API", () => {
    it("returns local mode when Shopify is not configured", async () => {
      const getResponse = await getCart(new Request("http://localhost/api/cart"));
      assert.equal(getResponse.status, 200);
      const getBody = (await getResponse.json()) as { mode: string };
      assert.equal(getBody.mode, "local");

      const postResponse = await postCart(
        new Request("http://localhost/api/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create" }),
        }),
      );
      assert.equal(postResponse.status, 200);
      const postBody = (await postResponse.json()) as { mode: string };
      assert.equal(postBody.mode, "local");
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
  });

  describe("rate limiting helper", () => {
    after(async () => {
      await resetRateLimits();
    });

    it("returns retryAfter when bucket is full", async () => {
      await resetRateLimits();
      const key = "integration:test";
      await checkRateLimit(key, 1, 60_000);
      const blocked = await checkRateLimit(key, 1, 60_000);
      assert.equal(blocked.ok, false);
    });
  });
});
