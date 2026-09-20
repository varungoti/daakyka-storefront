import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { db } from "@/lib/db";
import {
  BackInStockVariantInStockError,
  BackInStockVariantNotFoundError,
  subscribeToBackInStock,
  sweepBackInStock,
} from "@/lib/back-in-stock";
import { POST as backInStockRoute } from "@/app/api/back-in-stock/route";
import { GET as cronGet, POST as cronRoute } from "@/app/api/cron/back-in-stock/route";
import { withEnv } from "../helpers/env";

/**
 * Shopify-parity gap (docs/audit-2026-09-19/storefront-ux.md): back-in-stock
 * "Notify me" capture + restock detection. This environment has no Brevo
 * configured (deliberately — see src/lib/engagement/outbox.test.ts's own
 * header comment), so every send here exercises the real "queued as
 * PENDING, provider:stub" path rather than ever calling a real provider.
 */

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdSubscriptionIds: string[] = [];
const createdOutboxIds: string[] = [];

after(async () => {
  if (createdSubscriptionIds.length > 0) {
    await db.backInStockSubscription.deleteMany({ where: { id: { in: createdSubscriptionIds } } }).catch(() => {});
  }
  if (createdOutboxIds.length > 0) {
    await db.emailOutbox.deleteMany({ where: { id: { in: createdOutboxIds } } }).catch(() => {});
  }
  if (createdProductIds.length > 0) {
    await db.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {});
  }
  if (createdCategoryIds.length > 0) {
    await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {});
  }
});

async function createProductWithVariant(stock: number) {
  const unique = randomUUID().slice(0, 8);
  const category = await db.category.create({
    data: { name: `BIS Test Category ${unique}`, slug: `bis-test-category-${unique}`, section: "GENERAL" },
  });
  createdCategoryIds.push(category.id);

  const product = await db.product.create({
    data: {
      name: `BIS Test Product ${unique}`,
      slug: `bis-test-product-${unique}`,
      categoryId: category.id,
      status: "ACTIVE",
      price: 500,
    },
  });
  createdProductIds.push(product.id);

  const variant = await db.productVariant.create({
    data: { productId: product.id, sku: `DK-BIS-${unique}`, size: "M", color: "Navy", stock, active: true },
  });

  return { product, variant };
}

/** Every subscription row this file creates directly (not through
 * subscribeToBackInStock, whose successful-dedupe path doesn't return the
 * id) is tracked for cleanup by re-querying after each such call. */
async function trackSubscriptionsFor(variantId: string, email: string): Promise<void> {
  const rows = await db.backInStockSubscription.findMany({ where: { variantId, email }, select: { id: true } });
  for (const row of rows) {
    if (!createdSubscriptionIds.includes(row.id)) createdSubscriptionIds.push(row.id);
  }
}

describe("subscribeToBackInStock", () => {
  it("rejects a variant id that doesn't exist", async () => {
    await assert.rejects(
      () => subscribeToBackInStock("does-not-exist", "buyer@example.com"),
      BackInStockVariantNotFoundError,
    );
  });

  it("rejects signing up for a variant that is currently in stock — never trusts the client's claim", async () => {
    const { variant } = await createProductWithVariant(5);
    await assert.rejects(
      () => subscribeToBackInStock(variant.id, "buyer@example.com"),
      BackInStockVariantInStockError,
    );
  });

  it("creates a pending subscription for an out-of-stock variant, normalizing the email", async () => {
    const { variant } = await createProductWithVariant(0);
    const email = `Buyer-${randomUUID()}@Example.com`;

    await subscribeToBackInStock(variant.id, email);
    await trackSubscriptionsFor(variant.id, email.trim().toLowerCase());

    const row = await db.backInStockSubscription.findFirst({ where: { variantId: variant.id } });
    assert.ok(row);
    assert.equal(row!.email, email.trim().toLowerCase());
    assert.equal(row!.notifiedAt, null);
  });

  it("de-dupes: the same email signing up twice for the same variant queues only once while pending", async () => {
    const { variant } = await createProductWithVariant(0);
    const email = `dedupe-${randomUUID()}@example.com`;

    await subscribeToBackInStock(variant.id, email);
    await subscribeToBackInStock(variant.id, email); // must not throw, and must not duplicate
    await trackSubscriptionsFor(variant.id, email);

    const count = await db.backInStockSubscription.count({ where: { variantId: variant.id, email } });
    assert.equal(count, 1, "a second signup for the same still-pending (email, variant) pair must not create a new row");
  });

  it("allows a fresh signup for a future restock cycle once the prior subscription was already notified", async () => {
    const { variant } = await createProductWithVariant(0);
    const email = `resubscribe-${randomUUID()}@example.com`;

    await subscribeToBackInStock(variant.id, email);
    await trackSubscriptionsFor(variant.id, email);

    // Simulate the sweep having already notified this subscription.
    await db.backInStockSubscription.updateMany({ where: { variantId: variant.id, email }, data: { notifiedAt: new Date() } });

    await subscribeToBackInStock(variant.id, email);
    await trackSubscriptionsFor(variant.id, email);

    const count = await db.backInStockSubscription.count({ where: { variantId: variant.id, email } });
    assert.equal(count, 2, "a new pending row should be allowed once the previous one was already notified");
  });
});

describe("sweepBackInStock", () => {
  it("does nothing for a variant that's still out of stock", async () => {
    const { variant } = await createProductWithVariant(0);
    const email = `still-out-${randomUUID()}@example.com`;
    await subscribeToBackInStock(variant.id, email);
    await trackSubscriptionsFor(variant.id, email);

    await sweepBackInStock();

    const row = await db.backInStockSubscription.findFirst({ where: { variantId: variant.id, email } });
    assert.equal(row!.notifiedAt, null);
  });

  it("notifies a pending subscription once stock returns, queuing the email via the durable outbox (no provider configured)", async () => {
    const { variant } = await createProductWithVariant(0);
    const email = `restocked-${randomUUID()}@example.com`;
    await subscribeToBackInStock(variant.id, email);
    await trackSubscriptionsFor(variant.id, email);

    await db.productVariant.update({ where: { id: variant.id }, data: { stock: 10 } });

    const result = await sweepBackInStock();
    assert.ok(result.notified >= 1);

    const row = await db.backInStockSubscription.findFirst({ where: { variantId: variant.id, email } });
    assert.ok(row!.notifiedAt, "expected the subscription to be marked notified");

    const outboxRow = await db.emailOutbox.findFirst({
      where: { to: email, kind: "back_in_stock" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(outboxRow, "expected the restock email to have been queued in the EmailOutbox");
    createdOutboxIds.push(outboxRow!.id);
    assert.equal(outboxRow!.status, "PENDING", "no provider is configured, so the send queues rather than vanishing");
    assert.equal(outboxRow!.attemptCount, 0, "a stub (unconfigured-provider) result must not consume the real retry budget");
  });

  it("is one-shot: a second sweep after the first notification does not send again", async () => {
    const { variant } = await createProductWithVariant(0);
    const email = `one-shot-${randomUUID()}@example.com`;
    await subscribeToBackInStock(variant.id, email);
    await trackSubscriptionsFor(variant.id, email);
    await db.productVariant.update({ where: { id: variant.id }, data: { stock: 10 } });

    await sweepBackInStock();
    const countAfterFirst = await db.emailOutbox.count({ where: { to: email, kind: "back_in_stock" } });
    assert.equal(countAfterFirst, 1);
    const firstRow = await db.emailOutbox.findFirst({ where: { to: email, kind: "back_in_stock" } });
    createdOutboxIds.push(firstRow!.id);

    // Restock doesn't magically dip back to 0 — a second sweep should find
    // this subscription already notified (notifiedAt set) and skip it.
    const secondResult = await sweepBackInStock();
    const countAfterSecond = await db.emailOutbox.count({ where: { to: email, kind: "back_in_stock" } });
    assert.equal(countAfterSecond, 1, "must not send a second restock email for an already-notified subscription");
    // Sanity: the second run may still process OTHER variants' pending
    // subscriptions concurrently created by other tests, so don't assert
    // result.notified === 0 globally — just that THIS email got exactly one.
    void secondResult;
  });

  it("only notifies the variant that actually restocked when multiple variants have pending subscriptions", async () => {
    const { variant: stillOut } = await createProductWithVariant(0);
    const { variant: restocked } = await createProductWithVariant(0);
    const emailA = `multi-still-out-${randomUUID()}@example.com`;
    const emailB = `multi-restocked-${randomUUID()}@example.com`;

    await subscribeToBackInStock(stillOut.id, emailA);
    await trackSubscriptionsFor(stillOut.id, emailA);
    await subscribeToBackInStock(restocked.id, emailB);
    await trackSubscriptionsFor(restocked.id, emailB);

    await db.productVariant.update({ where: { id: restocked.id }, data: { stock: 3 } });

    await sweepBackInStock();

    const stillOutRow = await db.backInStockSubscription.findFirst({ where: { variantId: stillOut.id, email: emailA } });
    const restockedRow = await db.backInStockSubscription.findFirst({ where: { variantId: restocked.id, email: emailB } });
    assert.equal(stillOutRow!.notifiedAt, null);
    assert.ok(restockedRow!.notifiedAt);

    const outboxRow = await db.emailOutbox.findFirst({ where: { to: emailB, kind: "back_in_stock" } });
    if (outboxRow) createdOutboxIds.push(outboxRow.id);
  });
});

describe("POST /api/back-in-stock", () => {
  it("returns the same generic success shape for a fresh signup and a duplicate — never reveals which", async () => {
    const { variant } = await createProductWithVariant(0);
    const email = `route-${randomUUID()}@example.com`;

    const first = await backInStockRoute(jsonRequest("http://localhost/api/back-in-stock", { variantId: variant.id, email }));
    assert.equal(first.status, 200);
    const firstBody = await first.json();

    const second = await backInStockRoute(jsonRequest("http://localhost/api/back-in-stock", { variantId: variant.id, email }));
    assert.equal(second.status, 200);
    const secondBody = await second.json();

    assert.deepEqual(firstBody, secondBody);
    await trackSubscriptionsFor(variant.id, email);

    const count = await db.backInStockSubscription.count({ where: { variantId: variant.id, email } });
    assert.equal(count, 1);
  });

  it("rejects an invalid body with 400", async () => {
    const response = await backInStockRoute(jsonRequest("http://localhost/api/back-in-stock", { variantId: "", email: "not-an-email" }));
    assert.equal(response.status, 400);
  });
});

describe("POST /api/cron/back-in-stock", () => {
  it("401s without the bearer secret", async () => {
    await withEnv({ CRON_SECRET: "cron-test-secret" }, async () => {
      const response = await cronRoute(new Request("http://localhost/api/cron/back-in-stock"));
      assert.equal(response.status, 401);
      const getResponse = await cronGet(new Request("http://localhost/api/cron/back-in-stock"));
      assert.equal(getResponse.status, 401);
    });
  });

  it("runs the sweep with a valid bearer secret", async () => {
    await withEnv({ CRON_SECRET: "cron-test-secret" }, async () => {
      const response = await cronRoute(
        new Request("http://localhost/api/cron/back-in-stock", { headers: { authorization: "Bearer cron-test-secret" } }),
      );
      assert.equal(response.status, 200);
      const data = (await response.json()) as { ok: boolean };
      assert.equal(data.ok, true);
    });
  });
});
