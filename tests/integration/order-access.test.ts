import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashOrderAccessToken } from "@/lib/orders/access-token";
import { createOrderFromCart } from "@/lib/orders/create-order";
import { checkOrderPageRateLimit, getAuthorizedOrder } from "@/lib/orders/get-order";
import { resetRateLimits } from "@/lib/security/rate-limit";

/**
 * Phase G hardening — fixes finding F2 (docs/audit-2026-09-19/security.md):
 * `/order/[number]` used to render full PII for any guessed/enumerated
 * order number, with no auth check and no rate limit. Covers the new
 * ownership/token authorization in getAuthorizedOrder (src/lib/orders/get-order.ts)
 * and the page-level rate limiter, both exercised directly per this
 * repo's convention (see the harness note in
 * tests/integration/customer-auth.test.ts: next/headers's cookies()/headers()
 * throw outside a real Next.js request, so framework-specific request
 * context is resolved by the thin page component, not by these functions
 * — the same reason loadOwnAddress takes an explicit customerId instead of
 * re-deriving a session itself).
 */

const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdCustomerIds: string[] = [];

after(async () => {
  await resetRateLimits();
  if (createdOrderIds.length > 0) {
    await db.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
  }
  if (createdProductIds.length > 0) {
    await db.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {});
  }
  if (createdCategoryIds.length > 0) {
    await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {});
  }
  if (createdCustomerIds.length > 0) {
    await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => {});
  }
});

const SHIPPING_ADDRESS = {
  name: "Buyer",
  line1: "1 Test Street",
  city: "Hyderabad",
  state: "Telangana",
  pincode: "500032",
  country: "IN",
};

async function createActiveProductWithVariant(stock: number) {
  const unique = randomUUID().slice(0, 8);
  const category = await db.category.create({
    data: {
      name: `Order Access Test Category ${unique}`,
      slug: `order-access-test-category-${unique}`,
      section: "GENERAL",
    },
  });
  createdCategoryIds.push(category.id);

  const product = await db.product.create({
    data: {
      name: `Order Access Test Product ${unique}`,
      slug: `order-access-test-product-${unique}`,
      categoryId: category.id,
      status: "ACTIVE",
      price: 500,
    },
  });
  createdProductIds.push(product.id);

  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `DK-ORDERACCESS-${unique}`,
      size: "M",
      color: "Navy",
      stock,
      active: true,
    },
  });

  return variant;
}

async function createTestOrder(opts: { customerId?: string; email?: string } = {}) {
  const variant = await createActiveProductWithVariant(5);
  const order = await createOrderFromCart({
    items: [{ variantId: variant.id, quantity: 1 }],
    email: opts.email ?? `buyer-${randomUUID().slice(0, 8)}@example.com`,
    shippingAddress: SHIPPING_ADDRESS,
    customerId: opts.customerId,
    paymentMethod: "ORDER_REQUEST",
  });
  createdOrderIds.push(order.id);
  return order;
}

describe("order access authorization (Phase G / F2 fix)", () => {
  it("createOrderFromCart mints a raw token whose hash (and only whose hash) is persisted", async () => {
    const order = await createTestOrder();
    assert.ok(order.accessToken, "a raw access token should be returned to the caller");

    const row = await db.order.findUnique({ where: { id: order.id } });
    assert.ok(row?.accessTokenHash, "the order row should have a persisted hash");
    assert.notEqual(row!.accessTokenHash, order.accessToken, "the raw token must never be stored as-is");
    assert.equal(row!.accessTokenHash, hashOrderAccessToken(order.accessToken));
  });

  it("lets a logged-in customer view an order they own, even with no token", async () => {
    const unique = randomUUID().slice(0, 8);
    const customer = await db.customer.create({
      data: { email: `owner-${unique}@example.com`, name: "Owner", passwordHash: "x" },
    });
    createdCustomerIds.push(customer.id);

    const order = await createTestOrder({ customerId: customer.id });

    const result = await getAuthorizedOrder({ number: order.number, token: null, customerId: customer.id });
    assert.ok(result, "the owning customer should be able to view their order");
    assert.equal(result!.id, order.id);
  });

  it("refuses a different logged-in customer, even though the order exists", async () => {
    const unique = randomUUID().slice(0, 8);
    const owner = await db.customer.create({
      data: { email: `owner2-${unique}@example.com`, name: "Owner", passwordHash: "x" },
    });
    const stranger = await db.customer.create({
      data: { email: `stranger-${unique}@example.com`, name: "Stranger", passwordHash: "x" },
    });
    createdCustomerIds.push(owner.id, stranger.id);

    const order = await createTestOrder({ customerId: owner.id });

    const result = await getAuthorizedOrder({ number: order.number, token: null, customerId: stranger.id });
    assert.equal(result, null, "a different customer must never see someone else's order");
  });

  it("lets a guest view their order with the correct access token", async () => {
    const order = await createTestOrder();

    const result = await getAuthorizedOrder({ number: order.number, token: order.accessToken, customerId: null });
    assert.ok(result, "the correct token should authorize the guest");
    assert.equal(result!.id, order.id);
  });

  it("returns null (404) for a missing token on a guest order", async () => {
    const order = await createTestOrder();
    const result = await getAuthorizedOrder({ number: order.number, token: null, customerId: null });
    assert.equal(result, null);
  });

  it("returns null (404) for a wrong token", async () => {
    const order = await createTestOrder();
    const result = await getAuthorizedOrder({
      number: order.number,
      token: "not-the-right-token",
      customerId: null,
    });
    assert.equal(result, null);
  });

  it("returns null (404) for an order number that doesn't exist, even with a well-formed token — never distinguishes 'not found' from 'not authorized'", async () => {
    const order = await createTestOrder();
    const result = await getAuthorizedOrder({
      number: "DK-2026-0000000000",
      token: order.accessToken,
      customerId: null,
    });
    assert.equal(result, null);
  });

  it("a valid token for order A cannot be used to read order B", async () => {
    const orderA = await createTestOrder();
    const orderB = await createTestOrder();

    const crossResult = await getAuthorizedOrder({
      number: orderB.number,
      token: orderA.accessToken,
      customerId: null,
    });
    assert.equal(crossResult, null, "order A's token must not unlock order B");

    // Sanity check: order A's own token still works on order A, so the
    // null above is really about cross-order scoping, not a broken token.
    const ownResult = await getAuthorizedOrder({ number: orderA.number, token: orderA.accessToken, customerId: null });
    assert.ok(ownResult);
    assert.equal(ownResult!.id, orderA.id);
  });

  it("a guest order's token is not accepted as ownership for an unrelated logged-in customer id", async () => {
    const unique = randomUUID().slice(0, 8);
    const stranger = await db.customer.create({
      data: { email: `stranger2-${unique}@example.com`, name: "Stranger", passwordHash: "x" },
    });
    createdCustomerIds.push(stranger.id);

    const order = await createTestOrder(); // guest order, customerId is null

    // Wrong token + a customerId that doesn't own the (customer-less) order.
    const result = await getAuthorizedOrder({
      number: order.number,
      token: "still-not-the-right-token",
      customerId: stranger.id,
    });
    assert.equal(result, null);
  });

  describe("page-level rate limiting (enumeration resistance)", () => {
    after(async () => {
      await resetRateLimits();
    });

    it("throttles repeated lookups from the same IP after 20 requests/minute", async () => {
      const ip = `unit-test-order-page-${randomUUID()}`;

      let blockedAt = -1;
      for (let i = 1; i <= 25; i++) {
        const result = await checkOrderPageRateLimit(ip);
        if (!result.ok) {
          blockedAt = i;
          assert.ok(result.retryAfter >= 1);
          break;
        }
      }
      assert.ok(blockedAt > 0 && blockedAt <= 21, `expected throttling by the 21st request, got blockedAt=${blockedAt}`);
    });

    it("tracks separate client IPs independently", async () => {
      const ipA = `unit-test-order-page-a-${randomUUID()}`;
      const ipB = `unit-test-order-page-b-${randomUUID()}`;

      for (let i = 0; i < 20; i++) {
        const result = await checkOrderPageRateLimit(ipA);
        assert.equal(result.ok, true, `ipA request ${i + 1} should not be throttled yet`);
      }
      const blockedA = await checkOrderPageRateLimit(ipA);
      assert.equal(blockedA.ok, false, "ipA should be throttled after 20 requests");

      const firstB = await checkOrderPageRateLimit(ipB);
      assert.equal(firstB.ok, true, "a different IP must not be affected by ipA's usage");
    });

    it("never throttles when there's no trustworthy client IP (getClientIp returned null)", async () => {
      // Mirrors rateLimitOrResponse's own handling of a null IP (F1 fix,
      // src/lib/security/rate-limit.ts): bucketing every unattributed
      // caller under one shared key would let a single attacker exhaust
      // that bucket and block every other unattributed visitor, which is
      // worse than skipping the throttle for this request. Called many
      // times in a loop to confirm it's a real bypass, not a fluke of
      // which request happened to land first.
      for (let i = 0; i < 25; i++) {
        const result = await checkOrderPageRateLimit(null);
        assert.equal(result.ok, true, `call ${i + 1} with a null IP should never be throttled`);
      }
    });
  });
});
