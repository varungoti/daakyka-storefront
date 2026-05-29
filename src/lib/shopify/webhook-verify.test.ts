import { createHmac } from "crypto";
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { verifyShopifyWebhookHmac } from "@/lib/shopify/webhook-verify";

describe("Shopify webhook HMAC", () => {
  const originalSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  after(() => {
    if (originalSecret === undefined) delete process.env.SHOPIFY_WEBHOOK_SECRET;
    else process.env.SHOPIFY_WEBHOOK_SECRET = originalSecret;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("accepts valid signature when secret is set", () => {
    process.env.SHOPIFY_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.NODE_ENV = "production";
    const body = JSON.stringify({ id: 123, email: "test@example.com" });
    const hmac = createHmac("sha256", "test-webhook-secret")
      .update(body, "utf8")
      .digest("base64");
    assert.equal(verifyShopifyWebhookHmac(body, hmac), true);
  });

  it("rejects invalid signature in production", () => {
    process.env.SHOPIFY_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.NODE_ENV = "production";
    const body = JSON.stringify({ id: 123 });
    assert.equal(verifyShopifyWebhookHmac(body, "bad-signature"), false);
  });

  it("rejects missing signature when secret is set", () => {
    process.env.SHOPIFY_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.NODE_ENV = "production";
    assert.equal(verifyShopifyWebhookHmac("{}", null), false);
  });

  it("allows unsigned webhooks in development when secret is unset", () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET;
    process.env.NODE_ENV = "development";
    assert.equal(verifyShopifyWebhookHmac("{}", null), true);
  });
});
