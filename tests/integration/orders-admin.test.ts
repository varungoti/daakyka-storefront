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
  RefundAcknowledgementRequiredError,
  updateOrderAdmin,
} from "@/lib/orders/admin-orders";
import { createOrderFromCart } from "@/lib/orders/create-order";
import { InvalidOrderStatusTransitionError } from "@/lib/orders/status-transitions";
import { GET as getOrders } from "@/app/api/admin/orders/route";
import { GET as getOrder, PATCH as patchOrder } from "@/app/api/admin/orders/[id]/route";
import { GET as exportOrders } from "@/app/api/admin/orders/export/route";
import type { Prisma } from "@/generated/prisma/client";
import { findAnyAdminId } from "../helpers/admin-user";

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
        // Deliberately NOT the baseOrderData default of RAZORPAY.
        // tests/integration/checkout.test.ts drives the real
        // POST /api/cron/cancel-stale-orders route, whose updateMany is
        // global by design: it cancels *every* PENDING_PAYMENT RAZORPAY
        // order with a null razorpayPaymentId created before the 30-minute
        // cutoff, with no way to scope it to one file's rows. The 2020
        // createdAt below (load-bearing for the date-range filter test) put
        // this fixture squarely inside that predicate, so a concurrent run
        // of that cron flipped orderA to CANCELLED mid-file and failed
        // "updates adminNotes independently of status" roughly 1 run in 12.
        // ORDER_REQUEST is the carve-out the cron itself asserts it skips,
        // and nothing here reads orderA.paymentMethod.
        paymentMethod: "ORDER_REQUEST",
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

  it("F-067: queues a customer email with the tracking number when an order moves to SHIPPED", async () => {
    const adminId = await findAnyAdminId();
    const email = `f067-shipped-${randomUUID().slice(0, 8)}@example.com`;
    const processing = await db.order.create({ data: baseOrderData({ status: "PROCESSING", email }) });
    createdOrderIds.push(processing.id);

    const shipped = await updateOrderAdmin(
      processing.id,
      { status: "SHIPPED", trackingNumber: "F067TRK", courier: "Bluedart" },
      adminId,
    );
    assert.equal(shipped.status, "SHIPPED");

    const rows = await db.emailOutbox.findMany({ where: { to: email } });
    assert.equal(rows.length, 1, "exactly one outbox row should be queued for the ship notification");
    assert.equal(rows[0]?.kind, "order_shipped_customer");
    assert.match(rows[0]?.html ?? "", /F067TRK/);
  });

  it("F-067: queues a customer email when an order moves to CANCELLED", async () => {
    const adminId = await findAnyAdminId();
    const email = `f067-cancelled-${randomUUID().slice(0, 8)}@example.com`;
    const processing = await db.order.create({ data: baseOrderData({ status: "PROCESSING", email }) });
    createdOrderIds.push(processing.id);

    const cancelled = await updateOrderAdmin(processing.id, { status: "CANCELLED" }, adminId);
    assert.equal(cancelled.status, "CANCELLED");

    const rows = await db.emailOutbox.findMany({ where: { to: email } });
    assert.equal(rows.length, 1, "exactly one outbox row should be queued for the cancellation notice");
    assert.equal(rows[0]?.kind, "order_cancelled_customer");
  });

  it("F-067: a notes-only or tracking-only edit does not queue a status-change email", async () => {
    const adminId = await findAnyAdminId();
    const email = `f067-notes-${randomUUID().slice(0, 8)}@example.com`;
    const processing = await db.order.create({ data: baseOrderData({ status: "PROCESSING", email }) });
    createdOrderIds.push(processing.id);

    await updateOrderAdmin(processing.id, { adminNotes: "Called the customer." }, adminId);
    await updateOrderAdmin(processing.id, { trackingNumber: "PRETRK", courier: "Bluedart" }, adminId);

    const rows = await db.emailOutbox.count({ where: { to: email } });
    assert.equal(rows, 0, "no status changed, so no status-change email should be queued");
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

  // F-036/F-282 fix (release-hardening order-lifecycle-payment-integrity):
  // a paid RAZORPAY order used to keep its stock (and discount
  // redemption) permanently deducted on cancel/refund — "nothing to give
  // back" was only ever true *before* payment — and setting one to
  // CANCELLED/REFUNDED moved no money with no warning. It now requires an
  // explicit acknowledgement of that (RefundAcknowledgementRequiredError)
  // and, once acknowledged, restocks and releases the redemption exactly
  // like an ORDER_REQUEST cancel already did.

  async function createPaidRazorpayOrder(stock: number, quantity: number) {
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
      data: { productId: product.id, sku: `DK-OA-RZP-${unique}`, size: "M", color: "Navy", stock, active: true },
    });

    // Simulate a paid Razorpay order: stock already decremented and
    // razorpayPaymentId set (as the verify/webhook flow would have done
    // at payment time), order at PAID.
    const order = await db.order.create({
      data: baseOrderData({
        email: `orders-admin-razorpay-${unique}@example.com`,
        status: "PAID",
        paymentMethod: "RAZORPAY",
        razorpayPaymentId: `pay_${unique}`,
        items: { create: [{ variantId: variant.id, productName: "Test Scrub Set", unitPrice: 500, quantity }] },
      }),
    });
    createdOrderIds.push(order.id);
    await db.productVariant.update({ where: { id: variant.id }, data: { stock: { decrement: quantity } } });

    return { order, variant };
  }

  it("rejects cancelling a paid RAZORPAY order without acknowledging that no refund is issued", async () => {
    const adminId = await findAnyAdminId();
    const { order, variant } = await createPaidRazorpayOrder(3, 2);

    await assert.rejects(
      () => updateOrderAdmin(order.id, { status: "CANCELLED" }, adminId),
      RefundAcknowledgementRequiredError,
    );

    const unchanged = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(unchanged.status, "PAID", "the status must not change when the acknowledgement is missing");
    const untouchedVariant = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(untouchedVariant?.stock, 1, "stock must be untouched when the update is rejected");
  });

  it("restocks a paid RAZORPAY order on cancel once acknowledged", async () => {
    const adminId = await findAnyAdminId();
    const { order, variant } = await createPaidRazorpayOrder(3, 2);

    const updated = await updateOrderAdmin(
      order.id,
      { status: "CANCELLED", acknowledgeExternalRefund: true },
      adminId,
    );
    assert.equal(updated.status, "CANCELLED");

    const afterCancel = await db.productVariant.findUnique({ where: { id: variant.id } });
    assert.equal(afterCancel?.stock, 3, "cancelling an acknowledged paid RAZORPAY order must restore its stock");
  });

  it("does not require acknowledgement (or move stock) for a never-paid RAZORPAY order", async () => {
    const adminId = await findAnyAdminId();
    const unique = randomUUID().slice(0, 8);
    const order = await db.order.create({
      data: baseOrderData({
        email: `orders-admin-razorpay-unpaid-${unique}@example.com`,
        status: "PENDING_PAYMENT",
        paymentMethod: "RAZORPAY",
      }),
    });
    createdOrderIds.push(order.id);

    const updated = await updateOrderAdmin(order.id, { status: "CANCELLED" }, adminId);
    assert.equal(updated.status, "CANCELLED", "a never-paid order has nothing to acknowledge — no money was ever taken");
  });

  it("OrderUpdateConflictError is exported and constructs a useful message", () => {
    const err = new OrderUpdateConflictError("some-id");
    assert.match(err.message, /some-id/);
    assert.equal(err.name, "OrderUpdateConflictError");
  });

  // F-335 fix: every status transition now goes through the same
  // optimistic-concurrency-guarded transaction the restock path already
  // used, instead of only the restock branch being guarded. This
  // reproduces the exact finding: two admins racing SHIP vs CANCEL on the
  // same order must never both "succeed" (the ship winning while the
  // cancel's restock/discount-release also applied, or vice versa) —
  // exactly one wins, the other gets OrderUpdateConflictError.
  it("F-335: a concurrent ship and cancel on the same order — exactly one wins, the loser gets a conflict, and stock reflects only the winner", async () => {
    const adminId = await findAnyAdminId();
    // createOrderRequestOrder creates the order straight into PROCESSING
    // (ORDER_REQUEST's initial status — see create-order.ts), which is
    // exactly the pre-race state the F-335 finding needs: PROCESSING can
    // go to either SHIPPED or CANCELLED.
    const { order, variant } = await createOrderRequestOrder(5, 2);

    const results = await Promise.allSettled([
      updateOrderAdmin(order.id, { status: "SHIPPED", trackingNumber: "TRK-RACE", courier: "Bluedart" }, adminId),
      updateOrderAdmin(order.id, { status: "CANCELLED" }, adminId),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one of the two concurrent updates must succeed");
    assert.equal(rejected.length, 1, "the other must be rejected as a conflict");
    assert.ok(
      (rejected[0] as PromiseRejectedResult).reason instanceof OrderUpdateConflictError,
      "the loser must fail with OrderUpdateConflictError, not silently apply",
    );

    const finalOrder = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    const finalVariant = await db.productVariant.findUnique({ where: { id: variant.id } });
    if (finalOrder.status === "SHIPPED") {
      // Ship won: stock stays at what checkout decremented (2 units).
      assert.equal(finalVariant?.stock, 3);
    } else {
      // Cancel won: restocked back to the original 5.
      assert.equal(finalOrder.status, "CANCELLED");
      assert.equal(finalVariant?.stock, 5);
    }
  });

  // F-339 fix: adminNotes is no longer silently overwritten by a
  // concurrent status-only update from a stale page — enforced here via
  // the `updatedAt` precondition (the client-side "don't resend unchanged
  // notes" half of the fix lives in order-detail-actions.tsx).
  it("F-339: rejects a save whose updatedAt precondition no longer matches (a colleague's note landed first)", async () => {
    const adminId = await findAnyAdminId();
    const order = await db.order.create({ data: baseOrderData({ email: "conflict-notes@example.com" }) });
    createdOrderIds.push(order.id);

    // Admin B saves a note first.
    const afterB = await updateOrderAdmin(order.id, { adminNotes: "Customer called: deliver after 6pm." }, adminId);

    // Admin A's tab loaded the order *before* B's save (stale updatedAt).
    await assert.rejects(
      () =>
        updateOrderAdmin(
          order.id,
          { status: "PROCESSING", adminNotes: "", updatedAt: order.updatedAt },
          adminId,
        ),
      OrderUpdateConflictError,
    );

    const unchanged = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(unchanged.adminNotes, afterB.adminNotes, "B's note must survive A's stale, rejected save");
    assert.equal(unchanged.status, "PENDING_PAYMENT", "the status change from the rejected save must not apply either");
  });

  it("F-339: a save with a matching (fresh) updatedAt still succeeds", async () => {
    const adminId = await findAnyAdminId();
    const order = await db.order.create({ data: baseOrderData({ email: "fresh-updatedat@example.com" }) });
    createdOrderIds.push(order.id);

    const updated = await updateOrderAdmin(
      order.id,
      { adminNotes: "Fresh save.", updatedAt: order.updatedAt },
      adminId,
    );
    assert.equal(updated.adminNotes, "Fresh save.");
  });
});

// F-224 fix (release-hardening schema-foundation): listOrdersForAdmin used
// to load every matching row and sort/paginate in JS. These assert the
// DB-side count/skip/take actually pages correctly — disjoint, stable
// (id tie-breaker) pages whose union is every matching row, and a
// `total`/`totalPages` that reflects the real DB count rather than
// `items.length`.
describe("orders admin pagination (F-224)", () => {
  const marker = `pagination-${randomUUID().slice(0, 8)}`;
  const pageTestOrderIds: string[] = [];

  before(async () => {
    // Five orders, all matching the same search term, with distinct
    // `total` values so total-desc/total-asc sorting is meaningfully
    // exercised (not just createdAt, which is close to identical for
    // rows created back-to-back in the same test).
    for (let i = 0; i < 5; i += 1) {
      const order = await db.order.create({
        data: baseOrderData({
          number: `DK-TEST-PAGE-${marker}-${i}`,
          email: `${marker}@example.com`,
          total: 1000 + i * 100,
        }),
      });
      pageTestOrderIds.push(order.id);
      createdOrderIds.push(order.id);
    }
  });

  it("total/totalPages reflect the real DB count, not the current page's length", async () => {
    const result = await listOrdersForAdmin({ search: marker, pageSize: 2 });
    assert.equal(result.total, 5);
    assert.equal(result.totalPages, 3);
    assert.equal(result.items.length, 2);
  });

  it("pages are disjoint and their union covers every matching row exactly once", async () => {
    const pageSize = 2;
    const seen = new Set<string>();
    for (let page = 1; page <= 3; page += 1) {
      const result = await listOrdersForAdmin({ search: marker, pageSize, page, sort: "total-desc" });
      for (const item of result.items) {
        assert.ok(!seen.has(item.id), `order ${item.id} appeared on more than one page`);
        seen.add(item.id);
      }
    }
    assert.equal(seen.size, 5);
    for (const id of pageTestOrderIds) assert.ok(seen.has(id));
  });

  it("total-desc sorts by total across pages, not just within one page", async () => {
    const pageOne = await listOrdersForAdmin({ search: marker, pageSize: 2, page: 1, sort: "total-desc" });
    const pageTwo = await listOrdersForAdmin({ search: marker, pageSize: 2, page: 2, sort: "total-desc" });
    assert.deepEqual(
      pageOne.items.map((i) => i.total),
      [1400, 1300],
    );
    assert.deepEqual(
      pageTwo.items.map((i) => i.total),
      [1200, 1100],
    );
  });

  it("clamps an out-of-range page to the last page", async () => {
    const result = await listOrdersForAdmin({ search: marker, pageSize: 2, page: 999 });
    assert.equal(result.page, 3);
    assert.equal(result.items.length, 1);
  });

  it("exportOrdersCsv still returns every matching row, unbounded by pageSize", async () => {
    const csv = await exportOrdersCsv({ search: marker });
    const dataLines = csv.trim().split("\n").slice(1); // drop the header row
    assert.equal(dataLines.length, 5);
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
