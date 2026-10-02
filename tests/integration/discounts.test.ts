import { createHmac, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { db } from "@/lib/db";
import { createOrderFromCart, EmptyCartError } from "@/lib/orders/create-order";
import { POST as discountPreviewRoute } from "@/app/api/checkout/discount/route";
import { POST as verifyRoute } from "@/app/api/checkout/verify/route";
import { POST as webhookRoute } from "@/app/api/webhooks/razorpay/route";
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
  DiscountValidationError,
  DuplicateDiscountCodeError,
  normalizeDiscountCode,
  resolveDiscount,
  updateDiscount,
} from "@/lib/discounts";
import { getSetting } from "@/lib/settings";
import { withEnv } from "../helpers/env";
import { findAnyAdminId } from "../helpers/admin-user";

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
const TEST_WEBHOOK_SECRET = "discounts-test-webhook-secret";

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];
const createdDiscountIds: string[] = [];
// F-251: orders whose conflict notification / emails the tests below inspect.
const notificationOrderNumbers: string[] = [];

after(async () => {
  if (notificationOrderNumbers.length > 0) {
    await db.emailOutbox
      .deleteMany({ where: { OR: notificationOrderNumbers.map((number) => ({ subject: { contains: number } })) } })
      .catch(() => {});
    await db.adminNotification
      .deleteMany({ where: { OR: notificationOrderNumbers.map((number) => ({ metadata: { contains: number } })) } })
      .catch(() => {});
  }
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
    assert.equal(
      (error as DiscountMinSubtotalError).message,
      "Add ₹500 more to your cart to use this code (minimum order ₹2,000)",
    );
  });

  // F-127: the shortfall used to go through `toFixed(0)`, so 800.01 read "Add ₹800 more".
  it("keeps the paise in the minimum-order shortfall message (F-127)", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { minSubtotal: 1000 });
    const error = await resolveDiscount(discount.code, 199.99, "buyer@example.com").catch((e) => e);
    assert.ok(error instanceof DiscountMinSubtotalError);
    assert.equal((error as DiscountMinSubtotalError).shortfall, 800.01);
    assert.equal(
      (error as DiscountMinSubtotalError).message,
      "Add ₹800.01 more to your cart to use this code (minimum order ₹1,000)",
    );
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

  // F-038: a create rejects a >100% PERCENTAGE code outright (superRefine
  // on discountSchema — see schemas.test.ts for the pure-schema cases).
  // These two exercise the gap a create-only check misses: a PATCH that's
  // only invalid once MERGED with the row it's patching.
  it("rejects a PATCH that would push an existing PERCENTAGE code's value over 100", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "PERCENTAGE", value: 10 });
    await assert.rejects(
      () => updateDiscount(discount.id, { value: 500 }, admin),
      DiscountValidationError,
    );

    const unchanged = await db.discount.findUniqueOrThrow({ where: { id: discount.id } });
    assert.equal(Number(unchanged.value), 10, "the value must not have been written");
  });

  it("rejects a PATCH whose new endsAt would land at or before the existing startsAt", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, {
      startsAt: new Date("2026-12-31T00:00:00+05:30"),
    });
    await assert.rejects(
      () => updateDiscount(discount.id, { endsAt: new Date("2026-01-01T00:00:00+05:30") }, admin),
      DiscountValidationError,
    );
  });

  it("allows a PATCH that only changes an unrelated field on an otherwise-invalid-looking-but-untouched record", async () => {
    // A FIXED-type code is never subject to the percentage cap, even if
    // its numeric value happens to be over 100 (₹150 off is fine).
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "FIXED", value: 150 });
    const updated = await updateDiscount(discount.id, { active: false }, admin);
    assert.equal(updated.active, false);
    assert.equal(Number(updated.value), 150);
  });

  // F-038: a code saved BEFORE the rules existed (a fat-fingered 150%) is
  // exactly the one the owner needs to switch off. The merged check must not
  // re-validate its untouched, already-bad fields on an unrelated patch — a
  // bare { active: false } used to be a 400 that left the code live.
  it("still lets an already-invalid legacy code be deactivated, while refusing to keep it over 100", async () => {
    const admin = await findAnyAdminId();
    const legacy = await createTestDiscount(admin, { type: "PERCENTAGE", value: 150 });

    const deactivated = await updateDiscount(legacy.id, { active: false }, admin);
    assert.equal(deactivated.active, false);
    assert.equal(Number(deactivated.value), 150, "an unrelated patch must not rewrite the stored value");

    await assert.rejects(() => updateDiscount(legacy.id, { value: 120 }, admin), DiscountValidationError);

    const fixed = await updateDiscount(legacy.id, { value: 15 }, admin);
    assert.equal(Number(fixed.value), 15);
  });
});

// F-288: the audit row for a discount edit used to be {code, active}, so
// raising a 5% code to 90% left no trace of the old value.
describe("admin discount audit trail (F-288)", () => {
  it("records the old and new value, type and caps when a discount is edited", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "PERCENTAGE", value: 5 });

    await updateDiscount(discount.id, { value: 90, maxRedemptions: 10 }, admin);

    const rows = await db.auditLog.findMany({
      where: { entity: "discount", entityId: discount.id, action: "update" },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    assert.equal(rows.length, 1);
    const metadata = JSON.parse(rows[0].metadata!) as {
      code: string;
      changes: Record<string, { from: unknown; to: unknown }>;
    };
    assert.equal(metadata.code, discount.code);
    assert.deepEqual(metadata.changes.value, { from: 5, to: 90 });
    assert.deepEqual(metadata.changes.maxRedemptions, { from: null, to: 10 });
    assert.equal(metadata.changes.type, undefined, "an unchanged field is not listed");
  });

  it("records the limits a code was created with", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "FIXED", value: 150 });
    const rows = await db.auditLog.findMany({ where: { entity: "discount", entityId: discount.id, action: "create" } });
    assert.equal(rows.length, 1);
    const metadata = JSON.parse(rows[0].metadata!) as { type: string; value: number; active: boolean };
    assert.equal(metadata.type, "FIXED");
    assert.equal(metadata.value, 150);
    assert.equal(metadata.active, true);
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

// F-251: the paid-but-over-the-cap branch. A RAZORPAY order prices its code at
// creation but only commits the redemption when payment lands (see the
// "defers the redemption commit" test above), so the cap can fill up in
// between. The money is already captured by then, so the order must still be
// PAID at the discounted price — flagged for an admin, never failed, and the
// redemption count must not exceed the cap.
describe("a discount whose cap filled up before a RAZORPAY payment landed (F-251)", () => {
  async function createRacedOrder() {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "FIXED", value: 75, maxRedemptions: 1 });

    // The paying shopper's order is created and priced while the code still has room...
    const { variant } = await createActiveProductWithVariant({ stock: 5, price: 1000 });
    const paying = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email: `discount-conflict-${randomUUID().slice(0, 8)}@example.com`,
      shippingAddress: testAddress,
      paymentMethod: "RAZORPAY",
      discountCode: discount.code,
    });
    createdOrderIds.push(paying.id);
    notificationOrderNumbers.push(paying.number);
    const razorpayOrderId = `order_${randomUUID().slice(0, 12)}`;
    await db.order.update({ where: { id: paying.id }, data: { razorpayOrderId } });

    // ...then another shopper takes the only redemption (an ORDER_REQUEST commits at once).
    const { variant: otherVariant } = await createActiveProductWithVariant({ stock: 5, price: 1000 });
    const other = await createOrderFromCart({
      items: [{ variantId: otherVariant.id, quantity: 1 }],
      email: `discount-conflict-other-${randomUUID().slice(0, 8)}@example.com`,
      shippingAddress: testAddress,
      paymentMethod: "ORDER_REQUEST",
      discountCode: discount.code,
    });
    createdOrderIds.push(other.id);
    assert.equal((await db.discount.findUniqueOrThrow({ where: { id: discount.id } })).redeemedCount, 1, "the cap is now full");

    return { discount, paying, variant, razorpayOrderId };
  }

  async function assertConflictHandled(raced: Awaited<ReturnType<typeof createRacedOrder>>) {
    const { discount, paying, variant } = raced;
    const order = await db.order.findUniqueOrThrow({ where: { id: paying.id } });
    assert.equal(order.status, "PAID", "the money was captured, so the order is PAID");
    assert.equal(Number(order.discount), 75, "the shopper keeps the discounted price they were charged");
    assert.equal(Number(order.total), paying.total);
    assert.match(order.adminNotes ?? "", /DISCOUNT CONFLICT/);
    assert.doesNotMatch(order.adminNotes ?? "", /STOCK CONFLICT/, "stock was fine — only the cap conflicted");

    const notifications = await db.adminNotification.findMany({
      where: { type: "order_discount_conflict", metadata: { contains: paying.number } },
    });
    assert.equal(notifications.length, 1, "an admin is asked to review it");
    assert.ok(notifications[0]!.metadata?.includes(discount.code), "the notification names the code");
    assert.equal(
      await db.adminNotification.count({ where: { type: "order_stock_conflict", metadata: { contains: paying.number } } }),
      0,
    );

    const dbDiscount = await db.discount.findUniqueOrThrow({ where: { id: discount.id } });
    assert.equal(dbDiscount.redeemedCount, 1, "the cap is never exceeded");
    assert.equal(await db.discountRedemption.count({ where: { orderId: paying.id } }), 0, "no redemption is recorded for the late order");
    assert.equal((await db.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock, 4, "the order is still fulfilled from stock");
  }

  it("via /api/checkout/verify", async () => {
    const raced = await createRacedOrder();
    const paymentId = `pay_${randomUUID().slice(0, 12)}`;
    const signature = createHmac("sha256", TEST_KEY_SECRET).update(`${raced.razorpayOrderId}|${paymentId}`).digest("hex");

    await withEnv({ RAZORPAY_KEY_SECRET: TEST_KEY_SECRET }, async () => {
      const response = await verifyRoute(
        jsonRequest("http://localhost/api/checkout/verify", {
          orderNumber: raced.paying.number,
          razorpayPaymentId: paymentId,
          razorpayOrderId: raced.razorpayOrderId,
          razorpaySignature: signature,
        }),
      );
      assert.equal(response.status, 200, "a captured payment must never be failed over a discount cap");
    });

    await assertConflictHandled(raced);
  });

  it("via the Razorpay webhook", async () => {
    const raced = await createRacedOrder();
    const rawBody = JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_${randomUUID().slice(0, 12)}`,
            order_id: raced.razorpayOrderId,
            status: "captured",
            amount: Math.round(raced.paying.total * 100),
            currency: "INR",
          },
        },
      },
    });

    await withEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET }, async () => {
      const response = await webhookRoute(
        new Request("http://localhost/api/webhooks/razorpay", {
          method: "POST",
          headers: { "x-razorpay-signature": createHmac("sha256", TEST_WEBHOOK_SECRET).update(rawBody, "utf8").digest("hex") },
          body: rawBody,
        }),
      );
      assert.equal(response.status, 200);
    });

    await assertConflictHandled(raced);
  });
});

// F-251: nothing called the checkout page's live "Have a discount code?"
// preview. It is non-authoritative and must stay side-effect free, but it is
// what tells a shopper the code works, so a regression here is a lost sale.
describe("POST /api/checkout/discount (F-251)", () => {
  function preview(body: unknown): Promise<Response> {
    return discountPreviewRoute(jsonRequest("http://localhost/api/checkout/discount", body));
  }

  async function lineFor(price: number, quantity: number, stock = 10) {
    const { variant } = await createActiveProductWithVariant({ stock, price });
    return { variantId: variant.id, quantity };
  }

  it("returns the server-computed amount and subtotal, ignoring any figures the client sends", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "PERCENTAGE", value: 10 });
    const item = await lineFor(1000, 2);

    const response = await preview({
      items: [item],
      code: `  ${discount.code.toLowerCase()}  `,
      email: "preview-buyer@example.com",
      // Not part of the contract — must change nothing.
      subtotal: 1,
      amount: 2000,
      price: 1,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      code: discount.code,
      type: "PERCENTAGE",
      value: 10,
      amount: 200,
      subtotal: 2000,
    });
  });

  it("answers a fixed code the same way and never exceeds the subtotal", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { type: "FIXED", value: 5000 });
    const response = await preview({ items: [await lineFor(300, 1)], code: discount.code });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { amount: number; subtotal: number };
    assert.equal(body.subtotal, 300);
    assert.equal(body.amount, 300, "a discount can never be larger than what is being bought");
  });

  it("rejects an expired, an inactive, a not-yet-started and a below-minimum code with the matching message", async () => {
    const admin = await findAnyAdminId();
    const item = await lineFor(1000, 1);
    const cases: { code: string; message: string }[] = [
      {
        code: (await createTestDiscount(admin, { endsAt: new Date(Date.now() - 86_400_000) })).code,
        message: "This discount code has expired",
      },
      { code: (await createTestDiscount(admin, { active: false })).code, message: "This discount code is no longer active" },
      {
        code: (await createTestDiscount(admin, { startsAt: new Date(Date.now() + 86_400_000) })).code,
        message: "This discount code isn't active yet",
      },
      {
        code: (await createTestDiscount(admin, { minSubtotal: 5000 })).code,
        message: "Add ₹4,000 more to your cart to use this code (minimum order ₹5,000)",
      },
    ];
    for (const { code, message } of cases) {
      const response = await preview({ items: [item], code });
      assert.equal(response.status, 400, message);
      assert.deepEqual(await response.json(), { error: message });
    }
  });

  it("rejects an unknown code and a code that has reached its usage limit", async () => {
    const admin = await findAnyAdminId();
    const item = await lineFor(1000, 1);

    const unknown = await preview({ items: [item], code: "NOSUCHCODE" });
    assert.equal(unknown.status, 400);
    assert.deepEqual(await unknown.json(), { error: "Invalid discount code" });

    const discount = await createTestDiscount(admin, { maxRedemptions: 1 });
    const { variant } = await createActiveProductWithVariant({ stock: 5 });
    const order = await createOrderFromCart({
      items: [{ variantId: variant.id, quantity: 1 }],
      email: `preview-cap-${randomUUID().slice(0, 8)}@example.com`,
      shippingAddress: testAddress,
      paymentMethod: "ORDER_REQUEST",
      discountCode: discount.code,
    });
    createdOrderIds.push(order.id);
    const full = await preview({ items: [item], code: discount.code });
    assert.equal(full.status, 400);
    assert.deepEqual(await full.json(), { error: "This discount code has reached its usage limit" });
  });

  it("changes nothing: a preview never counts against a code's cap", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin, { maxRedemptions: 1 });
    const item = await lineFor(1000, 1);

    for (let i = 0; i < 3; i += 1) {
      assert.equal((await preview({ items: [item], code: discount.code })).status, 200);
    }
    const row = await db.discount.findUniqueOrThrow({ where: { id: discount.id } });
    assert.equal(row.redeemedCount, 0);
    assert.equal(await db.discountRedemption.count({ where: { discountId: discount.id } }), 0);
  });

  it("rejects a malformed request and a cart it cannot price, without leaking why", async () => {
    const admin = await findAnyAdminId();
    const discount = await createTestDiscount(admin);

    const emptyCart = await preview({ items: [], code: discount.code });
    assert.equal(emptyCart.status, 400);
    assert.deepEqual(await emptyCart.json(), { error: "Invalid request" });

    const noCode = await preview({ items: [await lineFor(1000, 1)] });
    assert.equal(noCode.status, 400);

    const soldOut = await preview({ items: [await lineFor(1000, 1, 0)], code: discount.code });
    assert.equal(soldOut.status, 400);
    assert.deepEqual(await soldOut.json(), { error: "Could not validate this code right now" });
  });
});
