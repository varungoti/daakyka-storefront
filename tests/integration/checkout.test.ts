import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { db } from "@/lib/db";
import {
  createOrderFromCart,
  EmptyCartError,
  InvalidVariantError,
  OutOfStockError,
} from "@/lib/orders/create-order";
import { checkRateLimit, resetRateLimits } from "@/lib/security/rate-limit";
import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { POST as verifyRoute } from "@/app/api/checkout/verify/route";
import { POST as webhookRoute } from "@/app/api/webhooks/razorpay/route";
import { GET as cronGet, POST as cronPost } from "@/app/api/cron/cancel-stale-orders/route";
import { withEnv } from "../helpers/env";

/**
 * Phase D3: checkout, Razorpay verify/webhook, and the stale-order cron.
 * Exercised at both the library layer (createOrderFromCart's re-pricing
 * and validation rules) and the route layer (request/response shape,
 * signature checks, idempotency), the same split used by
 * tests/integration/catalog-products.test.ts.
 */

const TEST_KEY_SECRET = "checkout-test-key-secret";
const TEST_WEBHOOK_SECRET = "checkout-test-webhook-secret";

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function rawRequest(url: string, rawBody: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers, body: rawBody });
}

const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdRateLimitKeys: string[] = [];

after(async () => {
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
  if (createdRateLimitKeys.length > 0) {
    await db.rateLimitBucket.deleteMany({ where: { key: { in: createdRateLimitKeys } } }).catch(() => {});
  }

  // Orders this file creates *through the real route* never get their id
  // pushed to createdOrderIds (the route returns a number, not the row),
  // so they used to survive every run and accumulate in the shared dev
  // and CI databases — 11 had piled up before this sweep was added.
  // Matching on the generated address is reliable because these emails
  // are uuid-suffixed and used nowhere else.
  const leaked = await db.order
    .findMany({ where: { email: { startsWith: "throttle-preseed-" } }, select: { id: true } })
    .catch(() => []);
  if (leaked.length > 0) {
    const ids = leaked.map((o) => o.id);
    await db.orderItem.deleteMany({ where: { orderId: { in: ids } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
  }
});

/**
 * Clears every throttle bucket this file can trip: the IP-keyed checkout
 * limiter and the email/phone-keyed ORDER_REQUEST throttle. The latter
 * matters because several tests here reuse the same placeholder phone,
 * so its hourly bucket accumulates across them and would eventually
 * block a later test's checkout. That used to be masked by other test
 * files calling an unscoped resetRateLimits() (a full-table wipe) at
 * arbitrary moments; now that those are correctly scoped, this file has
 * to clean up after itself.
 */
async function resetCheckoutIpBucket(): Promise<void> {
  await resetRateLimits(["checkout:", "order-request:"]);
}

/**
 * A fresh, valid-looking Indian mobile number for tests that count exact
 * requests against the phone-keyed ORDER_REQUEST throttle. Deliberately
 * *not* the "9876543210" placeholder used pervasively elsewhere in this
 * file (e.g. every other checkoutRoute call) — that phone's throttle
 * bucket accumulates real hits across every test that submits it through
 * the live route, which would make an exact-count test flaky depending on
 * what ran earlier.
 */
function randomIndianMobile(): string {
  const firstDigit = String(6 + Math.floor(Math.random() * 4)); // 6-9
  let rest = "";
  for (let i = 0; i < 9; i++) rest += String(Math.floor(Math.random() * 10));
  return firstDigit + rest;
}

async function createActiveProductWithVariant(opts: { stock: number; price?: number }) {
  const unique = randomUUID().slice(0, 8);
  const category = await db.category.create({
    data: { name: `Checkout Test Category ${unique}`, slug: `checkout-test-category-${unique}`, section: "GENERAL" },
  });
  createdCategoryIds.push(category.id);

  const product = await db.product.create({
    data: {
      name: `Checkout Test Product ${unique}`,
      slug: `checkout-test-product-${unique}`,
      categoryId: category.id,
      status: "ACTIVE",
      price: opts.price ?? 500,
    },
  });
  createdProductIds.push(product.id);

  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `DK-CHECKOUT-${unique}`,
      size: "M",
      color: "Navy",
      stock: opts.stock,
      active: true,
    },
  });

  return { product, variant, unique };
}

describe("createOrderFromCart (Phase D3)", () => {
  it("re-prices every line from the DB, ignoring any price the caller supplies", async () => {
    const { product, variant } = await createActiveProductWithVariant({ stock: 10, price: 750 });

    // Simulate a manipulated client payload: only {variantId, quantity} is
    // a valid CreateOrderItemInput, but cast to `any` to prove an injected
    // extra field (e.g. a client trying to smuggle its own price) is
    // simply ignored — the type doesn't even expose a slot to read it
    // from, and the function never looks at anything but variantId/qty.
    const manipulatedItems = [{ variantId: variant.id, quantity: 2, price: 1 }] as unknown as {
      variantId: string;
      quantity: number;
    }[];

    const order = await createOrderFromCart({
      items: manipulatedItems,
      email: "buyer@example.com",
      phone: "9876543210",
      shippingAddress: {
        name: "Buyer",
        line1: "1 Test Street",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500032",
        country: "IN",
      },
      paymentMethod: "RAZORPAY",
    });
    createdOrderIds.push(order.id);

    assert.equal(order.subtotal, Number(product.price) * 2);
    assert.equal(order.status, "PENDING_PAYMENT");
    assert.equal(order.paymentMethod, "RAZORPAY");

    const dbOrder = await db.order.findUnique({ where: { id: order.id }, include: { items: true } });
    assert.equal(Number(dbOrder!.items[0].unitPrice), Number(product.price));
  });

  it("rejects an empty cart", async () => {
    await assert.rejects(
      () =>
        createOrderFromCart({
          items: [],
          email: "buyer@example.com",
          shippingAddress: {
            name: "Buyer",
            line1: "1 Test Street",
            city: "Hyderabad",
            state: "Telangana",
            pincode: "500032",
            country: "IN",
          },
          paymentMethod: "RAZORPAY",
        }),
      EmptyCartError,
    );
  });

  it("rejects an out-of-stock variant", async () => {
    const { variant } = await createActiveProductWithVariant({ stock: 1 });

    const error = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 5 }],
      email: "buyer@example.com",
      shippingAddress: {
        name: "Buyer",
        line1: "1 Test Street",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500032",
        country: "IN",
      },
      paymentMethod: "RAZORPAY",
    }).catch((e) => e);

    assert.ok(error instanceof OutOfStockError);
    assert.equal((error as OutOfStockError).available, 1);
    assert.equal((error as OutOfStockError).requested, 5);
  });

  it("rejects an inactive variant and a variant on a non-ACTIVE product", async () => {
    const { variant } = await createActiveProductWithVariant({ stock: 10 });
    await db.productVariant.update({ where: { id: variant.id }, data: { active: false } });

    await assert.rejects(
      () =>
        createOrderFromCart({
          items: [{ variantId: variant.id, quantity: 1 }],
          email: "buyer@example.com",
          shippingAddress: {
            name: "Buyer",
            line1: "1 Test Street",
            city: "Hyderabad",
            state: "Telangana",
            pincode: "500032",
            country: "IN",
          },
          paymentMethod: "RAZORPAY",
        }),
      InvalidVariantError,
    );
  });

  it("decrements stock immediately for ORDER_REQUEST orders and creates them as PROCESSING", async () => {
    const { variant } = await createActiveProductWithVariant({ stock: 5 });

    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 3 }],
      email: "buyer@example.com",
      shippingAddress: {
        name: "Buyer",
        line1: "1 Test Street",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500032",
        country: "IN",
      },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(order.id);

    assert.equal(order.status, "PROCESSING");

    const updatedVariant = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(updatedVariant?.stock, 2);
  });
});

describe("POST /api/checkout (Phase D3)", () => {
  it("falls back to ORDER_REQUEST when Razorpay is not configured", async () => {
    const { variant } = await createActiveProductWithVariant({ stock: 5 });

    await withEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }, async () => {
      const response = await checkoutRoute(
        jsonRequest("http://localhost/api/checkout", {
          items: [{ variantId: variant.id, quantity: 1 }],
          email: "fallback-buyer@example.com",
          phone: "9876543210",
          shippingAddress: {
            name: "Buyer",
            line1: "1 Test Street",
            city: "Hyderabad",
            state: "Telangana",
            pincode: "500032",
            country: "IN",
          },
        }),
      );

      assert.equal(response.status, 200);
      const data = (await response.json()) as {
        orderNumber: string;
        orderToken: string;
        fallback: boolean;
        razorpayOrderId?: string;
      };
      assert.equal(data.fallback, true);
      assert.equal(data.razorpayOrderId, undefined);
      assert.match(data.orderNumber, /^DK-\d{4}-\d{10}$/);
      assert.ok(data.orderToken && data.orderToken.length > 0, "checkout response should include a guest access token");

      const order = await db.order.findUnique({ where: { number: data.orderNumber } });
      assert.ok(order);
      createdOrderIds.push(order!.id);
      assert.equal(order!.paymentMethod, "ORDER_REQUEST");
      assert.equal(order!.status, "PROCESSING");
      assert.ok(order!.accessTokenHash, "the order row should have a persisted access-token hash");
    });
  });

  it("rejects an invalid body with 400", async () => {
    const response = await checkoutRoute(
      jsonRequest("http://localhost/api/checkout", {
        items: [],
        email: "not-an-email",
        phone: "123",
        shippingAddress: { name: "x" },
      }),
    );
    assert.equal(response.status, 400);
  });

  // Release-hardening Finding A: a live order was placed with phone
  // "12345" and pincode "AB123" — only the empty "Full name" field was
  // ever blocked, by the browser's native `required`. These exercise the
  // real route handler end-to-end.

  it("rejects the exact garbage phone/pincode from the live audit, with a useful message, and creates no order", async () => {
    await resetCheckoutIpBucket();
    const { variant } = await createActiveProductWithVariant({ stock: 5 });
    const email = `garbage-contact-${randomUUID()}@example.com`;

    const response = await checkoutRoute(
      jsonRequest("http://localhost/api/checkout", {
        items: [{ variantId: variant.id, quantity: 1 }],
        email,
        phone: "12345",
        shippingAddress: {
          name: "Buyer",
          line1: "1 Test Street",
          city: "Hyderabad",
          state: "Telangana",
          pincode: "AB123",
          country: "IN",
        },
      }),
    );

    assert.equal(response.status, 400);
    const data = (await response.json()) as { error: string; issues: Array<{ path: (string | number)[]; message: string }> };
    const phoneIssue = data.issues.find((issue) => issue.path.join(".") === "phone");
    const pincodeIssue = data.issues.find((issue) => issue.path.join(".") === "shippingAddress.pincode");
    assert.ok(phoneIssue?.message.length, "expected a useful message for the invalid phone");
    assert.ok(pincodeIssue?.message.length, "expected a useful message for the invalid pincode");

    const order = await db.order.findFirst({ where: { email } });
    assert.equal(order, null, "no order should ever be created for an invalid contact/address");

    const untouchedVariant = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(untouchedVariant?.stock, 5, "stock must be untouched when checkout is rejected");
  });

  it("accepts and normalises legitimate phone/pincode shapes (+91 prefix, spaces) all the way into the stored order", async () => {
    await resetCheckoutIpBucket();
    const { variant } = await createActiveProductWithVariant({ stock: 5 });
    const email = `normalised-contact-${randomUUID()}@example.com`;

    await withEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }, async () => {
      const response = await checkoutRoute(
        jsonRequest("http://localhost/api/checkout", {
          items: [{ variantId: variant.id, quantity: 1 }],
          email,
          phone: "+91 98765 43210",
          shippingAddress: {
            name: "Buyer",
            line1: "1 Test Street",
            city: "Hyderabad",
            state: "Telangana",
            pincode: "500 032",
            country: "IN",
          },
        }),
      );

      assert.equal(response.status, 200);
      const data = (await response.json()) as { orderNumber: string };

      const order = await db.order.findUnique({ where: { number: data.orderNumber } });
      assert.ok(order);
      createdOrderIds.push(order!.id);
      assert.equal(order!.phone, "9876543210");
      const storedAddress = order!.shippingAddress as unknown as { pincode: string };
      assert.equal(storedAddress.pincode, "500032");
    });
  });
});

describe("ORDER_REQUEST throttle — Finding B (release-hardening)", () => {
  // The exact counting/blocking behaviour (allows 5, blocks the 6th, keys
  // independently on email and phone, fails safe) is covered directly and
  // in isolation by src/lib/security/order-request-throttle.test.ts, which
  // calls orderRequestThrottleOrResponse straight — no HTTP route, no real
  // order creation, just the DB-backed counter itself. That keeps each
  // check to a single fast round trip.
  //
  // The route-level test below instead pre-seeds the bucket directly at
  // the limit and makes exactly *one* real checkoutRoute call, rather than
  // driving all 6 through the full order-creation path (variant lookup +
  // transaction + order-number generation, tens of ms each). This file's
  // RateLimitBucket table is shared DB state with several other
  // integration test files that call the *global* resetRateLimits() (a
  // full-table wipe) throughout their own test bodies — see
  // src/lib/security/rate-limit.ts. Minimising how long this test's own
  // request sequence runs minimises the window in which one of those
  // unrelated concurrent wipes could land and reset this bucket, while
  // still proving the real route enforces the throttle end-to-end and
  // never reaches createOrderFromCart when it does.
  it("blocks a checkout through the real route once the ORDER_REQUEST throttle is already at its limit", async () => {
    await resetCheckoutIpBucket();
    const { variant } = await createActiveProductWithVariant({ stock: 5 });
    const email = `throttle-preseed-${randomUUID()}@example.com`;
    const phone = randomIndianMobile();
    const emailKey = `order-request:email:${email.toLowerCase()}`;
    const phoneKey = `order-request:phone:${phone}`;
    createdRateLimitKeys.push(emailKey, phoneKey);

    for (let i = 0; i < 5; i++) {
      await checkRateLimit(emailKey, 5, 60 * 60 * 1000);
    }

    await withEnv({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined }, async () => {
      const response = await checkoutRoute(
        jsonRequest("http://localhost/api/checkout", {
          items: [{ variantId: variant.id, quantity: 1 }],
          email,
          phone,
          shippingAddress: {
            name: "Buyer",
            line1: "1 Test Street",
            city: "Hyderabad",
            state: "Telangana",
            pincode: "500032",
            country: "IN",
          },
        }),
      );
      assert.equal(response.status, 429);
      const data = (await response.json()) as { error: string };
      assert.match(data.error, /too many/i);
      assert.ok(response.headers.get("Retry-After"), "expected a Retry-After header on the 429");
    });

    const untouchedVariant = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(untouchedVariant?.stock, 5, "a throttled request must never reach createOrderFromCart");
  });

  // The RAZORPAY path is deliberately not exercised here through the full
  // route: with real Razorpay keys unset, isRazorpayConfigured() would
  // still resolve to the ORDER_REQUEST fallback; with real-looking keys,
  // createRazorpayOrder() would reach out to Razorpay's live API, which
  // this sandbox has no business calling from a test. The route only ever
  // calls orderRequestThrottleOrResponse when `!razorpayReady` (see
  // src/app/api/checkout/route.ts).
});

/**
 * Shared by the /verify, /webhooks/razorpay, and F3-race describe blocks
 * below: a PENDING_PAYMENT RAZORPAY order with one line item and a
 * razorpayOrderId already attached, as if /api/checkout had already run.
 */
async function createPendingRazorpayOrder(stock: number) {
  const { variant } = await createActiveProductWithVariant({ stock });
  const order = await createOrderFromCart({
    items: [{ variantId: variant.id, quantity: 1 }],
    email: "razorpay-buyer@example.com",
    shippingAddress: {
      name: "Buyer",
      line1: "1 Test Street",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "500032",
      country: "IN",
    },
    paymentMethod: "RAZORPAY",
  });
  createdOrderIds.push(order.id);

  const razorpayOrderId = `order_${randomUUID().slice(0, 12)}`;
  await db.order.update({ where: { id: order.id }, data: { razorpayOrderId } });

  return { order, variant, razorpayOrderId };
}

describe("POST /api/checkout/verify (Phase D3)", () => {
  it("rejects a tampered signature and leaves the order unpaid", async () => {
    const { order, razorpayOrderId } = await createPendingRazorpayOrder(5);
    const paymentId = `pay_${randomUUID().slice(0, 12)}`;

    await withEnv({ RAZORPAY_KEY_SECRET: TEST_KEY_SECRET }, async () => {
      const response = await verifyRoute(
        jsonRequest("http://localhost/api/checkout/verify", {
          orderNumber: order.number,
          razorpayPaymentId: paymentId,
          razorpayOrderId,
          razorpaySignature: "not-a-real-signature",
        }),
      );
      assert.equal(response.status, 400);
    });

    const dbOrder = await db.order.findUnique({ where: { id: order.id } });
    assert.equal(dbOrder?.status, "PENDING_PAYMENT");
  });

  it("accepts a valid signature, marks the order PAID, and decrements stock exactly once", async () => {
    const { order, variant, razorpayOrderId } = await createPendingRazorpayOrder(5);
    const paymentId = `pay_${randomUUID().slice(0, 12)}`;
    const validSignature = createHmac("sha256", TEST_KEY_SECRET)
      .update(`${razorpayOrderId}|${paymentId}`)
      .digest("hex");

    await withEnv({ RAZORPAY_KEY_SECRET: TEST_KEY_SECRET }, async () => {
      const response = await verifyRoute(
        jsonRequest("http://localhost/api/checkout/verify", {
          orderNumber: order.number,
          razorpayPaymentId: paymentId,
          razorpayOrderId,
          razorpaySignature: validSignature,
        }),
      );
      assert.equal(response.status, 200);
      const data = (await response.json()) as { ok: boolean };
      assert.equal(data.ok, true);

      // A second call with the same (now-stale) signature must be
      // idempotent and must not decrement stock again.
      const secondResponse = await verifyRoute(
        jsonRequest("http://localhost/api/checkout/verify", {
          orderNumber: order.number,
          razorpayPaymentId: paymentId,
          razorpayOrderId,
          razorpaySignature: validSignature,
        }),
      );
      assert.equal(secondResponse.status, 200);
    });

    const dbOrder = await db.order.findUnique({ where: { id: order.id } });
    assert.equal(dbOrder?.status, "PAID");
    assert.equal(dbOrder?.razorpayPaymentId, paymentId);

    const updatedVariant = await db.productVariant.findUnique({ where: { id: variant.id } });
    // Started at stock 5, one unit ordered — decremented exactly once
    // despite two verify calls.
    assert.equal(updatedVariant?.stock, 4);
  });
});

describe("POST /api/webhooks/razorpay (Phase D3)", () => {
  it("rejects a request with an invalid signature", async () => {
    await withEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET }, async () => {
      const response = await webhookRoute(
        rawRequest("http://localhost/api/webhooks/razorpay", JSON.stringify({ event: "payment.captured" }), {
          "x-razorpay-signature": "bad-signature",
        }),
      );
      assert.equal(response.status, 401);
    });
  });

  it("is idempotent: processing the same payment.captured event twice decrements stock only once", async () => {
    const { variant } = await createActiveProductWithVariant({ stock: 5 });
    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 2 }],
      email: "webhook-buyer@example.com",
      shippingAddress: {
        name: "Buyer",
        line1: "1 Test Street",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500032",
        country: "IN",
      },
      paymentMethod: "RAZORPAY",
    });
    createdOrderIds.push(order.id);

    const razorpayOrderId = `order_${randomUUID().slice(0, 12)}`;
    await db.order.update({ where: { id: order.id }, data: { razorpayOrderId } });

    const paymentId = `pay_${randomUUID().slice(0, 12)}`;
    const rawBody = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: paymentId, order_id: razorpayOrderId, status: "captured" } } },
    });

    await withEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET }, async () => {
      const signature = createHmac("sha256", TEST_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex");
      const headers = { "x-razorpay-signature": signature };

      const first = await webhookRoute(rawRequest("http://localhost/api/webhooks/razorpay", rawBody, headers));
      assert.equal(first.status, 200);

      const second = await webhookRoute(rawRequest("http://localhost/api/webhooks/razorpay", rawBody, headers));
      assert.equal(second.status, 200);
    });

    const dbOrder = await db.order.findUnique({ where: { id: order.id } });
    assert.equal(dbOrder?.status, "PAID");

    const updatedVariant = await db.productVariant.findUnique({ where: { id: variant.id } });
    // Started at 5, ordered 2 — decremented exactly once across both
    // webhook deliveries.
    assert.equal(updatedVariant?.stock, 3);
  });
});

describe("verify + webhook concurrency (F3 fix)", () => {
  // Release-hardening Finding F3: /api/checkout/verify and the Razorpay
  // webhook both read order.status outside any lock, then independently
  // decide whether to decrement stock. If the browser's /verify call and
  // Razorpay's webhook delivery for the *same* payment both observe
  // "not yet PAID" before either commits, the old code let both
  // transactions decrement stock and flip status to PAID — this test
  // fires both real route handlers at once (not mocks) to reproduce that
  // exact race and prove the atomic status-flip gate closes it.
  it("a concurrent /verify call and webhook delivery for the same payment decrement stock exactly once and leave the order PAID", async () => {
    const { order, variant, razorpayOrderId } = await createPendingRazorpayOrder(5);
    const paymentId = `pay_${randomUUID().slice(0, 12)}`;
    const validSignature = createHmac("sha256", TEST_KEY_SECRET).update(`${razorpayOrderId}|${paymentId}`).digest("hex");

    const webhookBody = JSON.stringify({
      event: "payment.captured",
      payload: { payment: { entity: { id: paymentId, order_id: razorpayOrderId, status: "captured" } } },
    });

    await withEnv({ RAZORPAY_KEY_SECRET: TEST_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET }, async () => {
      const webhookSignature = createHmac("sha256", TEST_WEBHOOK_SECRET).update(webhookBody, "utf8").digest("hex");

      // Promise.all, not sequential awaits: both handlers start from the
      // same PENDING_PAYMENT row and must each do several awaited DB round
      // trips (rate limit / signature checks, the order lookup) before
      // reaching their own transaction — so both are guaranteed to observe
      // the order as not-yet-PAID before either commits, exactly like the
      // real browser-callback-vs-webhook race.
      const [verifyResponse, webhookResponse] = await Promise.all([
        verifyRoute(
          jsonRequest("http://localhost/api/checkout/verify", {
            orderNumber: order.number,
            razorpayPaymentId: paymentId,
            razorpayOrderId,
            razorpaySignature: validSignature,
          }),
        ),
        webhookRoute(rawRequest("http://localhost/api/webhooks/razorpay", webhookBody, { "x-razorpay-signature": webhookSignature })),
      ]);

      // Both callers must see success regardless of which one actually won
      // the race — the browser gets a normal 200, and Razorpay must never
      // see a failure that would trigger a webhook retry storm.
      assert.equal(verifyResponse.status, 200);
      const verifyData = (await verifyResponse.json()) as { ok: boolean };
      assert.equal(verifyData.ok, true);

      assert.equal(webhookResponse.status, 200);
      const webhookData = (await webhookResponse.json()) as { ok: boolean };
      assert.equal(webhookData.ok, true);
    });

    const dbOrder = await db.order.findUnique({ where: { id: order.id } });
    assert.equal(dbOrder?.status, "PAID");
    assert.equal(dbOrder?.razorpayPaymentId, paymentId);

    const updatedVariant = await db.productVariant.findUnique({ where: { id: variant.id } });
    // Started at stock 5, one unit ordered — must be decremented exactly
    // once even though /verify and the webhook both ran concurrently for
    // the same payment. Before the F3 fix this landed on 3 (decremented
    // twice, one per caller).
    assert.equal(updatedVariant?.stock, 4);
  });
});

describe("POST /api/cron/cancel-stale-orders (Phase D3)", () => {
  it("401s without the bearer secret", async () => {
    await withEnv({ CRON_SECRET: "cron-test-secret" }, async () => {
      const response = await cronPost(new Request("http://localhost/api/cron/cancel-stale-orders"));
      assert.equal(response.status, 401);

      const getResponse = await cronGet(new Request("http://localhost/api/cron/cancel-stale-orders"));
      assert.equal(getResponse.status, 401);
    });
  });

  it("cancels a stale PENDING_PAYMENT RAZORPAY order older than 30 minutes, but not a fresh one or an ORDER_REQUEST one", async () => {
    const { variant: v1 } = await createActiveProductWithVariant({ stock: 5 });
    const { variant: v2 } = await createActiveProductWithVariant({ stock: 5 });
    const { variant: v3 } = await createActiveProductWithVariant({ stock: 5 });

    const staleOrder = await createOrderFromCart({
      items: [{ variantId: v1.id, quantity: 1 }],
      email: "stale@example.com",
      shippingAddress: {
        name: "Buyer",
        line1: "1 Test Street",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500032",
        country: "IN",
      },
      paymentMethod: "RAZORPAY",
    });
    createdOrderIds.push(staleOrder.id);
    const fortyMinutesAgo = new Date(Date.now() - 40 * 60 * 1000);
    await db.order.update({ where: { id: staleOrder.id }, data: { createdAt: fortyMinutesAgo } });

    const freshOrder = await createOrderFromCart({
      items: [{ variantId: v2.id, quantity: 1 }],
      email: "fresh@example.com",
      shippingAddress: {
        name: "Buyer",
        line1: "1 Test Street",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500032",
        country: "IN",
      },
      paymentMethod: "RAZORPAY",
    });
    createdOrderIds.push(freshOrder.id);

    const orderRequestOrder = await createOrderFromCart({
      items: [{ variantId: v3.id, quantity: 1 }],
      email: "orderrequest@example.com",
      shippingAddress: {
        name: "Buyer",
        line1: "1 Test Street",
        city: "Hyderabad",
        state: "Telangana",
        pincode: "500032",
        country: "IN",
      },
      paymentMethod: "ORDER_REQUEST",
    });
    createdOrderIds.push(orderRequestOrder.id);
    await db.order.update({ where: { id: orderRequestOrder.id }, data: { createdAt: fortyMinutesAgo } });

    await withEnv({ CRON_SECRET: "cron-test-secret" }, async () => {
      const response = await cronPost(
        new Request("http://localhost/api/cron/cancel-stale-orders", {
          headers: { authorization: "Bearer cron-test-secret" },
        }),
      );
      assert.equal(response.status, 200);
      const data = (await response.json()) as { ok: boolean; cancelled: number };
      assert.equal(data.ok, true);
      assert.ok(data.cancelled >= 1, `expected at least 1 cancelled order, got ${data.cancelled}`);
    });

    assert.equal((await db.order.findUnique({ where: { id: staleOrder.id } }))?.status, "CANCELLED");
    assert.equal((await db.order.findUnique({ where: { id: freshOrder.id } }))?.status, "PENDING_PAYMENT");
    assert.equal((await db.order.findUnique({ where: { id: orderRequestOrder.id } }))?.status, "PROCESSING");
  });
});
