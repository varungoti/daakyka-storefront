import { createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { db } from "@/lib/db";
import { createOrderFromCart, EmptyCartError } from "@/lib/orders/create-order";
import { POST as verifyRoute } from "@/app/api/checkout/verify/route";
import {
  commitDiscountRedemption,
  computeDiscountAmount,
  createDiscount,
  DiscountAlreadyUsedError,
  DiscountExpiredError,
  DiscountInactiveError,
  DiscountMinSubtotalError,
  DiscountNotFoundError,
  DiscountNotStartedError,
  DiscountUsageLimitReachedError,
  DuplicateDiscountCodeError,
  normalizeDiscountCode,
  resolveDiscount,
  updateDiscount,
} from "@/lib/discounts";
import { getSetting } from "@/lib/settings";
import { withEnv } from "../helpers/env";

/**
 * Release-hardening F7 (docs/audit-2026-09-19/storefront-ux.md finding F7):
 * discount codes at checkout. Exercised mostly at the library layer
 * (createOrderFromCart / resolveDiscount / commitDiscountRedemption)
 * rather than through the HTTP routes, matching the established split used
 * throughout this test suite (see tests/integration/orders-admin.test.ts's
 * own header comment: route handlers can't carry a real authenticated
 * session outside an actual Next.js request, so business rules are tested
 * directly against the functions the routes call). The one exception is a
 * single POST /api/checkout/verify call, needed to prove a RAZORPAY
 * order's discount commit really is deferred to the PAID transition.
 */

const TEST_KEY_SECRET = "discounts-test-key-secret";

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdDiscountIds: string[] = [];

after(async () => {
  if (createdOrderIds.length > 0) {
    await db.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => {});
    await db.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
  }
  if (createdDiscountIds.length > 0) {
    await db.discountRedemption.deleteMany({ where: { discountId: { in: createdDiscountIds } } }).catch(() => {});
    await db.discount.deleteMany({ where: { id: { in: createdDiscountIds } } }).catch(() => {});
  }
  if (createdProductIds.length > 0) {
    await db.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {});
  }
  if (createdCategoryIds.length > 0) {
    await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {});
  }
});

async function createActiveProductWithVariant(opts: { stock: number; price?: number }) {
  const unique = randomUUID().slice(0, 8);
  const category = await db.category.create({
    data: { name: `Discount Test Category ${unique}`, slug: `discount-test-category-${unique}`, section: "GENERAL" },
  });
  createdCategoryIds.push(category.id);

  const product = await db.product.create({
    data: {
      name: `Discount Test Product ${unique}`,
      slug: `discount-test-product-${unique}`,
      categoryId: category.id,
      status: "ACTIVE",
      price: opts.price ?? 500,
    },
  });
  createdProductIds.push(product.id);

  const variant = await db.productVariant.create({
    data: {
      productId: product.id,
      sku: `DK-DISC-${unique}`,
      size: "M",
      color: "Navy",
      stock: opts.stock,
      active: true,
    },
  });

  return { product, variant, unique };
}

const testAddress = {
  name: "Buyer",
  line1: "1 Test Street",
  city: "Hyderabad",
  state: "Telangana",
  pincode: "500032",
  country: "IN",
} as const;

interface CreateTestDiscountOptions {
  type?: "PERCENTAGE" | "FIXED";
  value?: number;
  minSubtotal?: number | null;
  maxRedemptions?: number | null;
  maxRedemptionsPerCustomer?: number | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
  active?: boolean;
}

async function createTestDiscount(userId: string, opts: CreateTestDiscountOptions = {}) {
  const code = `TEST${randomUUID().slice(0, 8).toUpperCase()}`;
  const discount = await createDiscount(
    {
      code,
      type: opts.type ?? "PERCENTAGE",
      value: opts.value ?? 10,
      minSubtotal: opts.minSubtotal ?? null,
      maxRedemptions: opts.maxRedemptions ?? null,
      maxRedemptionsPerCustomer: opts.maxRedemptionsPerCustomer ?? null,
      startsAt: opts.startsAt ?? null,
      endsAt: opts.endsAt ?? null,
      active: opts.active ?? true,
    },
    userId,
  );
  createdDiscountIds.push(discount.id);
  return discount;
}

describe("computeDiscountAmount", () => {
  it("computes a percentage discount and never exceeds the subtotal", () => {
    assert.equal(computeDiscountAmount("PERCENTAGE", 10, 1000), 100);
    // A fat-fingered >100% value is still capped at the subtotal, never
    // making the total negative.
    assert.equal(computeDiscountAmount("PERCENTAGE", 150, 1000), 1000);
  });

  it("computes a fixed discount and caps it at the subtotal", () => {
    assert.equal(computeDiscountAmount("FIXED", 150, 1000), 150);
    assert.equal(computeDiscountAmount("FIXED", 5000, 1000), 1000, "a fixed discount larger than the cart never goes negative");
  });
});

describe("resolveDiscount", () => {
  it("rejects an unknown code", async () => {
    await assert.rejects(() => resolveDiscount("DOES-NOT-EXIST", 1000, "buyer@example.com"), DiscountNotFoundError);
  });

  it("rejects an inactive code", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { active: false });
    await assert.rejects(() => resolveDiscount(discount.code, 1000, "buyer@example.com"), DiscountInactiveError);
  });

  it("rejects a code that hasn't started yet", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000) });
    await assert.rejects(() => resolveDiscount(discount.code, 1000, "buyer@example.com"), DiscountNotStartedError);
  });

  it("rejects an expired code", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { endsAt: new Date(Date.now() - 60 * 1000) });
    await assert.rejects(() => resolveDiscount(discount.code, 1000, "buyer@example.com"), DiscountExpiredError);
  });

  it("rejects a subtotal below the minimum, reporting the shortfall", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { minSubtotal: 2000 });
    const error = await resolveDiscount(discount.code, 1500, "buyer@example.com").catch((e) => e);
    assert.ok(error instanceof DiscountMinSubtotalError);
    assert.equal((error as DiscountMinSubtotalError).minSubtotal, 2000);
    assert.equal((error as DiscountMinSubtotalError).shortfall, 500);
  });

  it("is case-insensitive and trims whitespace", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "FIXED", value: 50 });
    const resolved = await resolveDiscount(`  ${discount.code.toLowerCase()}  `, 1000, "buyer@example.com");
    assert.equal(resolved.code, discount.code);
    assert.equal(resolved.amount, 50);
  });

  it("rejects a customer who has already used a per-customer-capped code", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { maxRedemptionsPerCustomer: 1 });
    const { variant } = await createActiveProductWithVariant({ stock: 5 });
    const email = `already-used-${randomUUID()}@example.com`;

    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email,
      shippingAddress: testAddress,
      paymentMethod: "ORDER_REQUEST",
      discountCode: discount.code,
    });
    createdOrderIds.push(order.id);

    await assert.rejects(() => resolveDiscount(discount.code, 1000, email), DiscountAlreadyUsedError);
  });
});

describe("createOrderFromCart discount integration", () => {
  it("computes the discount server-side and ignores any amount the caller supplies", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "FIXED", value: 50 });
    const { variant, product } = await createActiveProductWithVariant({ stock: 5, price: 500 });

    // CreateOrderFromCartInput has no slot for a discount amount at all —
    // cast to `any` to prove an injected field is simply never read, the
    // same technique the existing "re-prices every line" test in
    // tests/integration/checkout.test.ts uses for a manipulated price.
    const manipulated = {
      items: [{ variantId: variant.id, quantity: 1 }],
      email: "buyer@example.com",
      shippingAddress: testAddress,
      paymentMethod: "ORDER_REQUEST",
      discountCode: discount.code,
      discount: 999999,
      total: 1,
    } as unknown as Parameters<typeof createOrderFromCart>[0];

    const order = await createOrderFromCart(manipulated);
    createdOrderIds.push(order.id);

    assert.equal(order.discount, 50, "the discount must be exactly what the server computed from the DB row");
    assert.equal(order.subtotal, Number(product.price));
    assert.equal(order.total, order.subtotal + order.shipping - 50);
  });

  it("applies a percentage discount and commits the redemption immediately for ORDER_REQUEST", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "PERCENTAGE", value: 20 });
    const { variant } = await createActiveProductWithVariant({ stock: 5, price: 1000 });

    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email: "percent-buyer@example.com",
      shippingAddress: testAddress,
      paymentMethod: "ORDER_REQUEST",
      discountCode: discount.code,
    });
    createdOrderIds.push(order.id);

    assert.equal(order.discount, 200);
    assert.equal(order.discountCode, discount.code);

    const dbOrder = await db.order.findUnique({ where: { id: order.id } });
    assert.equal(Number(dbOrder!.discount), 200);
    assert.equal(dbOrder!.discountId, discount.id);

    const dbDiscount = await db.discount.findUnique({ where: { id: discount.id } });
    assert.equal(dbDiscount!.redeemedCount, 1, "ORDER_REQUEST has no payment gate, so the redemption is committed at creation");

    const redemption = await db.discountRedemption.findUnique({ where: { orderId: order.id } });
    assert.ok(redemption, "expected a DiscountRedemption row");
    assert.equal(redemption!.email, "percent-buyer@example.com");
  });

  it("rejects checkout outright when the subtotal is below the discount's minimum", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { minSubtotal: 5000 });
    const { variant } = await createActiveProductWithVariant({ stock: 5, price: 500 });
    const email = `min-subtotal-${randomUUID()}@example.com`;

    await assert.rejects(
      () =>
        createOrderFromCart({
          items: [{ variantId: variant.id, quantity: 1 }],
          email,
          shippingAddress: testAddress,
          paymentMethod: "ORDER_REQUEST",
          discountCode: discount.code,
        }),
      DiscountMinSubtotalError,
    );

    const order = await db.order.findFirst({ where: { email } });
    assert.equal(order, null, "no order should be created when the minimum subtotal isn't met");
  });

  it("rejects an expired code end-to-end", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { endsAt: new Date(Date.now() - 1000) });
    const { variant } = await createActiveProductWithVariant({ stock: 5 });
    const email = `expired-${randomUUID()}@example.com`;

    await assert.rejects(
      () =>
        createOrderFromCart({
          items: [{ variantId: variant.id, quantity: 1 }],
          email,
          shippingAddress: testAddress,
          paymentMethod: "ORDER_REQUEST",
          discountCode: discount.code,
        }),
      DiscountExpiredError,
    );
  });

  it("prices a RAZORPAY order's discount at creation but defers the redemption commit to PAID (via /api/checkout/verify)", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "FIXED", value: 75 });
    const { variant } = await createActiveProductWithVariant({ stock: 5, price: 1000 });

    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email: "razorpay-discount-buyer@example.com",
      shippingAddress: testAddress,
      paymentMethod: "RAZORPAY",
      discountCode: discount.code,
    });
    createdOrderIds.push(order.id);

    assert.equal(order.discount, 75, "the discount is priced in immediately so the Razorpay amount is correct");

    let dbDiscount = await db.discount.findUnique({ where: { id: discount.id } });
    assert.equal(dbDiscount!.redeemedCount, 0, "RAZORPAY must not commit the redemption before payment is verified");
    assert.equal(await db.discountRedemption.count({ where: { orderId: order.id } }), 0);

    const razorpayOrderId = `order_${randomUUID().slice(0, 12)}`;
    await db.order.update({ where: { id: order.id }, data: { razorpayOrderId } });

    const paymentId = `pay_${randomUUID().slice(0, 12)}`;
    const validSignature = createHmac("sha256", TEST_KEY_SECRET).update(`${razorpayOrderId}|${paymentId}`).digest("hex");

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
    });

    dbDiscount = await db.discount.findUnique({ where: { id: discount.id } });
    assert.equal(dbDiscount!.redeemedCount, 1, "the commit happens at PAID time for a RAZORPAY order");
    assert.equal(await db.discountRedemption.count({ where: { orderId: order.id } }), 1);
  });

  it("evaluates the free-shipping threshold on the PRE-discount subtotal", async () => {
    const [flatRate, freeAbove] = await Promise.all([
      getSetting("shipping.flatRate"),
      getSetting("shipping.freeAbove"),
    ]);
    void flatRate;

    const admin = await findAnyAdminId();
    // Price comfortably above the free-shipping threshold on its own...
    const price = freeAbove + 500;
    const { variant } = await createActiveProductWithVariant({ stock: 5, price });
    // ...then a fixed discount large enough that the POST-discount
    // subtotal would fall *below* the threshold, if it were (incorrectly)
    // evaluated after the discount.
    const discount = await createTestDiscount(admin, { type: "FIXED", value: 1000 });

    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email: "shipping-threshold-buyer@example.com",
      shippingAddress: testAddress,
      paymentMethod: "ORDER_REQUEST",
      discountCode: discount.code,
    });
    createdOrderIds.push(order.id);

    assert.equal(order.subtotal, price);
    assert.equal(order.discount, 1000);
    assert.ok(order.subtotal - order.discount < freeAbove, "test setup sanity check: post-discount subtotal is below the threshold");
    assert.equal(order.shipping, 0, "shipping must still be free — the threshold is evaluated before the discount is applied");
    assert.equal(order.total, order.subtotal - 1000);
  });
});

describe("usage cap concurrency", () => {
  it("a total-redemption cap of 1 is never exceeded across concurrent checkouts for different customers", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "FIXED", value: 10, maxRedemptions: 1 });

    const attempts = 5;
    const variants = await Promise.all(
      Array.from({ length: attempts }, () => createActiveProductWithVariant({ stock: 10, price: 500 })),
    );

    const results = await Promise.allSettled(
      variants.map((v, i) =>
        createOrderFromCart({
          items: [{ variantId: v.variant.id, quantity: 1 }],
          email: `cap-race-${i}-${randomUUID()}@example.com`,
          shippingAddress: testAddress,
          paymentMethod: "ORDER_REQUEST",
          discountCode: discount.code,
        }),
      ),
    );

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createOrderFromCart>>> => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    for (const r of fulfilled) createdOrderIds.push(r.value.id);

    assert.equal(fulfilled.length, 1, `expected exactly 1 of ${attempts} concurrent checkouts to win the capped code`);
    assert.equal(rejected.length, attempts - 1);
    for (const r of rejected as PromiseRejectedResult[]) {
      assert.ok(
        r.reason instanceof DiscountUsageLimitReachedError,
        `expected DiscountUsageLimitReachedError, got ${r.reason?.constructor?.name}: ${r.reason?.message}`,
      );
    }

    const dbDiscount = await db.discount.findUnique({ where: { id: discount.id } });
    assert.equal(dbDiscount!.redeemedCount, 1, "redeemedCount must land at exactly 1, never over- or under-counted");

    // Losers must never have an order row at all — the whole transaction
    // (including the order create) rolls back when commitDiscountRedemption
    // loses the race.
    const totalOrdersForDiscount = await db.order.count({ where: { discountId: discount.id } });
    assert.equal(totalOrdersForDiscount, 1);
  });

  it("a per-customer cap of 1 blocks a second concurrent redemption by the SAME customer, and releases the reserved slot back onto the code", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "FIXED", value: 10, maxRedemptionsPerCustomer: 1 });
    const email = `same-customer-race-${randomUUID()}@example.com`;

    const attempts = 3;
    const variants = await Promise.all(
      Array.from({ length: attempts }, () => createActiveProductWithVariant({ stock: 10, price: 500 })),
    );

    const results = await Promise.allSettled(
      variants.map((v) =>
        createOrderFromCart({
          items: [{ variantId: v.variant.id, quantity: 1 }],
          email,
          shippingAddress: testAddress,
          paymentMethod: "ORDER_REQUEST",
          discountCode: discount.code,
        }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const r of results) if (r.status === "fulfilled") createdOrderIds.push(r.value.id);

    assert.equal(fulfilled.length, 1, `expected exactly 1 of ${attempts} concurrent same-customer checkouts to win`);
    for (const r of rejected) {
      assert.ok(r.reason instanceof DiscountAlreadyUsedError, `expected DiscountAlreadyUsedError, got ${r.reason?.constructor?.name}`);
    }

    const dbDiscount = await db.discount.findUnique({ where: { id: discount.id } });
    assert.equal(
      dbDiscount!.redeemedCount,
      1,
      "the reserved slot for each losing per-customer-capped attempt must be released back (no net leak)",
    );
  });
});

describe("commitDiscountRedemption", () => {
  it("returns ok:false with reason usage_limit and does not create a redemption row when the cap is already full", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { maxRedemptions: 1 });
    const { variant } = await createActiveProductWithVariant({ stock: 5 });
    const firstOrder = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email: "first@example.com",
      shippingAddress: testAddress,
      paymentMethod: "ORDER_REQUEST",
      discountCode: discount.code,
    });
    createdOrderIds.push(firstOrder.id);

    const { variant: secondVariant } = await createActiveProductWithVariant({ stock: 5 });
    const secondOrder = await createOrderFromCart({
      items: [{ variantId: secondVariant.id, quantity: 1 }],
      email: "second@example.com",
      shippingAddress: testAddress,
      paymentMethod: "RAZORPAY",
    });
    createdOrderIds.push(secondOrder.id);

    const result = await db.$transaction((tx) =>
      commitDiscountRedemption(tx, {
        discountId: discount.id,
        maxRedemptions: 1,
        maxRedemptionsPerCustomer: null,
        orderId: secondOrder.id,
        email: "second@example.com",
      }),
    );
    assert.deepEqual(result, { ok: false, reason: "usage_limit" });
    assert.equal(await db.discountRedemption.count({ where: { orderId: secondOrder.id } }), 0);
  });
});

describe("admin discount CRUD", () => {
  it("normalizes the code to uppercase on create", async () => {
    const admin = await findAnyAdminId();
    const raw = `  hero${randomUUID().slice(0, 6)}  `;
    const discount = await createDiscount(
      { code: raw, type: "PERCENTAGE", value: 10 },
      admin,
    );
    createdDiscountIds.push(discount.id);
    assert.equal(discount.code, normalizeDiscountCode(raw));
    assert.equal(discount.code, discount.code.toUpperCase());
  });

  it("rejects a duplicate code (case-insensitively)", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin);
    await assert.rejects(
      () => createDiscount({ code: discount.code.toLowerCase(), type: "FIXED", value: 5 }, admin),
      DuplicateDiscountCodeError,
    );
  });

  it("can deactivate a code via updateDiscount, after which it's rejected at checkout", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { active: true });
    const updated = await updateDiscount(discount.id, { active: false }, admin);
    assert.equal(updated.active, false);

    await assert.rejects(() => resolveDiscount(discount.code, 1000, "buyer@example.com"), DiscountInactiveError);
  });
});

describe("createOrderFromCart still rejects an empty cart with a discount code present", () => {
  it("throws EmptyCartError before ever touching the discount", async () => {
    await assert.rejects(
      () =>
        createOrderFromCart({
          items: [],
          email: "buyer@example.com",
          shippingAddress: testAddress,
          paymentMethod: "ORDER_REQUEST",
          discountCode: "ANYTHING",
        }),
      EmptyCartError,
    );
  });
});
