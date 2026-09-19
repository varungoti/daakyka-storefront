import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  exportOrdersCsv,
  getOrderForAdmin,
  listOrdersForAdmin,
  MissingTrackingInfoError,
  OrderNotFoundError,
  OrderUpdateConflictError,
  updateOrderAdmin,
} from "@/lib/orders/admin-orders";
import { createOrderFromCart } from "@/lib/orders/create-order";
import { InvalidOrderStatusTransitionError } from "@/lib/orders/status-transitions";
import { GET as getOrders } from "@/app/api/admin/orders/route";
import { GET as getOrder, PATCH as patchOrder } from "@/app/api/admin/orders/[id]/route";
import { GET as exportOrders } from "@/app/api/admin/orders/export/route";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Phase D4: orders admin service layer (list filters, status transitions,
 * CSV export) plus a 401/403 check on every route handler.
 *
 * Route handlers can't be called with a real authenticated session outside
 * an actual Next.js request (see tests/integration/catalog-admin.test.ts
 * for the same constraint/rationale), so business rules are tested
 * directly against the service functions the routes call. Every order
 * created here is cleaned up in `after()`.
 */

async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];
const createdCategoryIds: string[] = [];

/**
 * Release-hardening Finding B: a real Product/ProductVariant, plus an
 * ORDER_REQUEST order created the same way checkout does (createOrderFromCart,
 * which decrements stock immediately — see its own docstring), so the
 * stock-restore-on-cancel tests below exercise the real decrement/restore
 * pair rather than a hand-built fixture.
 */
async function createOrderRequestOrder(stock: number, quantity: number) {
  const unique = randomUUID().slice(0, 8);
  const category = await db.category.create({
    data: { name: `Orders Admin Stock Category ${unique}`, slug: `orders-admin-stock-category-${unique}`, section: "GENERAL" },
  });
  createdCategoryIds.push(category.id);

  const product = await db.product.create({
    data: {
      name: `Orders Admin Stock Product ${unique}`,
      slug: `orders-admin-stock-product-${unique}`,
      categoryId: category.id,
      status: "ACTIVE",
      price: 500,
    },
  });
  createdProductIds.push(product.id);

  const variant = await db.productVariant.create({
    data: { productId: product.id, sku: `DK-OA-${unique}`, size: "M", color: "Navy", stock, active: true },
  });

  const order = await createOrderFromCart({
    items: [{ variantId: variant.id, quantity }],
    email: `orders-admin-stock-${unique}@example.com`,
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

  return { order, variant };
}

function baseOrderData(overrides: Partial<Prisma.OrderUncheckedCreateInput> = {}): Prisma.OrderUncheckedCreateInput {
  return {
    number: `DK-TEST-${Math.random().toString(36).slice(2, 10)}`,
    email: "orders-admin-test@example.com",
    shippingAddress: { name: "Test Buyer", line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500001", country: "IN" },
    subtotal: 1000,
    shipping: 99,
    discount: 0,
    total: 1099,
    currency: "INR",
    status: "PENDING_PAYMENT",
    paymentMethod: "RAZORPAY",
    items: { create: [{ productName: "Test Scrub Set", unitPrice: 1000, quantity: 1 }] },
    ...overrides,
  };
}

after(async () => {
  if (createdOrderIds.length > 0) {
    await db.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
  }
  if (createdProductIds.length > 0) {
    await db.product.deleteMany({ where: { id: { in: createdProductIds } } }).catch(() => {});
  }
  if (createdCategoryIds.length > 0) {
    await db.category.deleteMany({ where: { id: { in: createdCategoryIds } } }).catch(() => {});
  }
});

describe("orders admin service (Phase D4)", () => {
  let orderA: string; // PENDING_PAYMENT, older
  let orderB: string; // PAID, newer, distinct email

  before(async () => {
    const old = await db.order.create({
      data: baseOrderData({
        number: `DK-TEST-A-${Date.now()}`,
        email: "alpha@example.com",
        status: "PENDING_PAYMENT",
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
      }),
    });
    orderA = old.id;
    createdOrderIds.push(orderA);

    const recent = await db.order.create({
      data: baseOrderData({
        number: `DK-TEST-B-${Date.now()}`,
        email: "beta@example.com",
        status: "PAID",
        total: 2500,
      }),
    });
    orderB = recent.id;
    createdOrderIds.push(orderB);
  });

  it("filters by status", async () => {
    const result = await listOrdersForAdmin({ status: "PAID", search: "example.com" });
    const ids = result.items.map((o) => o.id);
    assert.ok(ids.includes(orderB));
    assert.ok(!ids.includes(orderA));
  });

  it("filters by search (order number or email)", async () => {
    const byEmail = await listOrdersForAdmin({ search: "alpha@example.com" });
    assert.ok(byEmail.items.some((o) => o.id === orderA));

    const orderANumber = (await db.order.findUniqueOrThrow({ where: { id: orderA } })).number;
    const byNumber = await listOrdersForAdmin({ search: orderANumber });
    assert.ok(byNumber.items.some((o) => o.id === orderA));
  });

  it("filters by date range", async () => {
    const result = await listOrdersForAdmin({
      search: "example.com",
      dateFrom: new Date("2019-01-01T00:00:00.000Z"),
      dateTo: new Date("2020-06-01T00:00:00.000Z"),
    });
    const ids = result.items.map((o) => o.id);
    assert.ok(ids.includes(orderA));
    assert.ok(!ids.includes(orderB));
  });

  it("computes item count and serializes Decimal money fields as numbers", async () => {
    const detail = await getOrderForAdmin(orderB);
    assert.equal(detail.items.length, 1);
    assert.equal(typeof detail.total, "number");
    assert.equal(detail.total, 2500);
  });

  it("accepts a valid status transition and updates the record", async () => {
    const adminId = await findAnyAdminId();
    const updated = await updateOrderAdmin(orderB, { status: "PROCESSING" }, adminId);
    assert.equal(updated.status, "PROCESSING");
    assert.ok(updated.updatedAt.getTime() >= updated.createdAt.getTime());
  });

  it("rejects an invalid status transition (DELIVERED -> PENDING_PAYMENT)", async () => {
    const adminId = await findAnyAdminId();
    const delivered = await db.order.create({ data: baseOrderData({ status: "DELIVERED", email: "gamma@example.com" }) });
    createdOrderIds.push(delivered.id);

    await assert.rejects(
      () => updateOrderAdmin(delivered.id, { status: "PENDING_PAYMENT" }, adminId),
      InvalidOrderStatusTransitionError,
    );

    const unchanged = await db.order.findUniqueOrThrow({ where: { id: delivered.id } });
    assert.equal(unchanged.status, "DELIVERED");
  });

  it("requires tracking number and courier when moving to SHIPPED", async () => {
    const adminId = await findAnyAdminId();
    const processing = await db.order.create({ data: baseOrderData({ status: "PROCESSING", email: "delta@example.com" }) });
    createdOrderIds.push(processing.id);

    await assert.rejects(() => updateOrderAdmin(processing.id, { status: "SHIPPED" }, adminId), MissingTrackingInfoError);

    const shipped = await updateOrderAdmin(
      processing.id,
      { status: "SHIPPED", trackingNumber: "TRK999", courier: "Bluedart" },
      adminId,
    );
    assert.equal(shipped.status, "SHIPPED");
    assert.equal(shipped.trackingNumber, "TRK999");
    assert.equal(shipped.courier, "Bluedart");
  });

  it("updates adminNotes independently of status", async () => {
    const adminId = await findAnyAdminId();
    const updated = await updateOrderAdmin(orderA, { adminNotes: "Called customer to confirm address." }, adminId);
    assert.equal(updated.adminNotes, "Called customer to confirm address.");
    assert.equal(updated.status, "PENDING_PAYMENT");
  });

  it("throws OrderNotFoundError for a missing order id", async () => {
    const adminId = await findAnyAdminId();
    await assert.rejects(() => getOrderForAdmin("does-not-exist"), OrderNotFoundError);
    await assert.rejects(() => updateOrderAdmin("does-not-exist", { adminNotes: "x" }, adminId), OrderNotFoundError);
  });

  it("exports a CSV containing the test orders", async () => {
    const csv = await exportOrdersCsv({ search: "example.com" });
    assert.match(csv, /order_number/);
    assert.match(csv, /alpha@example\.com/);
  });

  // Release-hardening Finding B: an ORDER_REQUEST order decrements stock
  // immediately at creation, with no payment gate (see createOrderFromCart).
  // Cancelling one before it ships must give that stock back — but exactly
  // once, never more.

  it("restores stock when an ORDER_REQUEST order is cancelled", async () => {
    const adminId = await findAnyAdminId();
    const { order, variant } = await createOrderRequestOrder(5, 2);

    const beforeCancel = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(beforeCancel?.stock, 3, "stock should already be decremented by checkout");

    const updated = await updateOrderAdmin(order.id, { status: "CANCELLED" }, adminId);
    assert.equal(updated.status, "CANCELLED");

    const afterCancel = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(afterCancel?.stock, 5, "cancelling should restore the 2 reserved units");
  });

  it("does not restock a second time when the same order is 'cancelled' again (no-op, no double-restore)", async () => {
    const adminId = await findAnyAdminId();
    const { order, variant } = await createOrderRequestOrder(5, 2);

    await updateOrderAdmin(order.id, { status: "CANCELLED" }, adminId);
    const afterFirstCancel = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(afterFirstCancel?.stock, 5);

    // Same status again — updateOrderAdmin's `input.status !== existing.status`
    // guard makes this a no-op (mirrors the existing behaviour any
    // same-status resubmission already had before this change), so it must
    // not restock a second time.
    const updatedAgain = await updateOrderAdmin(order.id, { status: "CANCELLED" }, adminId);
    assert.equal(updatedAgain.status, "CANCELLED");

    const afterSecondCancel = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(afterSecondCancel?.stock, 5, "a repeated cancel must not restock the same units twice");
  });

  it("does not restock a RAZORPAY order on cancel (unchanged, pre-existing behaviour)", async () => {
    const adminId = await findAnyAdminId();
    const unique = randomUUID().slice(0, 8);
    const category = await db.category.create({
      data: { name: `Orders Admin Razorpay Category ${unique}`, slug: `orders-admin-razorpay-category-${unique}`, section: "GENERAL" },
    });
    createdCategoryIds.push(category.id);
    const product = await db.product.create({
      data: { name: `Orders Admin Razorpay Product ${unique}`, slug: `orders-admin-razorpay-product-${unique}`, categoryId: category.id, status: "ACTIVE", price: 500 },
    });
    createdProductIds.push(product.id);
    const variant = await db.productVariant.create({
      data: { productId: product.id, sku: `DK-OA-RZP-${unique}`, size: "M", color: "Navy", stock: 3, active: true },
    });

    // Simulate a paid Razorpay order: stock already decremented (as the
    // verify/webhook flow would have done at payment time), order at PAID.
    const order = await db.order.create({
      data: baseOrderData({
        email: `orders-admin-razorpay-${unique}@example.com`,
        status: "PAID",
        paymentMethod: "RAZORPAY",
        items: { create: [{ variantId: variant.id, productName: "Test Scrub Set", unitPrice: 500, quantity: 2 }] },
      }),
    });
    createdOrderIds.push(order.id);
    await db.productVariant.update({ where: { id: variant.id }, data: { stock: { decrement: 2 } } });

    const updated = await updateOrderAdmin(order.id, { status: "CANCELLED" }, adminId);
    assert.equal(updated.status, "CANCELLED");

    const afterCancel = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(afterCancel?.stock, 1, "a RAZORPAY order's stock must be untouched by this Finding B change");
  });

  it("OrderUpdateConflictError is exported and constructs a useful message", () => {
    const err = new OrderUpdateConflictError("some-id");
    assert.match(err.message, /some-id/);
    assert.equal(err.name, "OrderUpdateConflictError");
  });
});

describe("orders admin routes without a session", () => {
  const idParams = Promise.resolve({ id: "any-id" });

  it("GET /api/admin/orders rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/orders");
    const response = await getOrders(request);
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("GET /api/admin/orders/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/orders/any-id");
    const response = await getOrder(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("PATCH /api/admin/orders/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/orders/any-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAID" }),
    });
    const response = await patchOrder(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("GET /api/admin/orders/export rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/orders/export");
    const response = await exportOrders(request);
    assert.ok(response.status === 401 || response.status === 403);
  });
});
