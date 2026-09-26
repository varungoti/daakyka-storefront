import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  CustomerNotFoundError,
  getCustomerForAdmin,
  listCustomersForAdmin,
  listGuestBuyersForAdmin,
  setCustomerActive,
} from "@/lib/customers/admin-customers";
import { GET as getCustomers } from "@/app/api/admin/customers/route";
import { GET as getCustomer, PATCH as patchCustomer } from "@/app/api/admin/customers/[id]/route";
import { findAnyAdminId } from "../helpers/admin-user";

/**
 * Phase D4: customers admin service layer (list aggregation, detail,
 * active/inactive toggle + sessionVersion revocation) plus a 401/403
 * check on every route handler. Same route-handler constraint as
 * tests/integration/catalog-admin.test.ts and orders-admin.test.ts.
 */

const createdCustomerIds: string[] = [];
const createdOrderIds: string[] = [];

after(async () => {
  if (createdOrderIds.length > 0) {
    await db.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
  }
  if (createdCustomerIds.length > 0) {
    await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => {});
  }
});

describe("customers admin service (Phase D4)", () => {
  let customerId: string;

  before(async () => {
    const customer = await db.customer.create({
      data: {
        email: `customer-admin-test-${randomUUID()}@example.com`,
        name: "Test Customer",
        phone: "+91 90000 00001",
        passwordHash: "not-a-real-hash",
        emailVerifiedAt: new Date(),
        sessionVersion: 0,
        active: true,
      },
    });
    customerId = customer.id;
    createdCustomerIds.push(customerId);

    // One order that counts toward spend (PAID) and one that doesn't
    // (PENDING_PAYMENT never paid, CANCELLED refunded conceptually).
    const paid = await db.order.create({
      data: {
        number: `DK-TEST-CUST-PAID-${Date.now()}`,
        customerId,
        email: customer.email,
        shippingAddress: { name: "Test Customer", line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500001", country: "IN" },
        subtotal: 1000,
        shipping: 0,
        discount: 0,
        total: 1000,
        currency: "INR",
        status: "PAID",
        paymentMethod: "RAZORPAY",
      },
    });
    const pending = await db.order.create({
      data: {
        number: `DK-TEST-CUST-PENDING-${Date.now()}`,
        customerId,
        email: customer.email,
        shippingAddress: { name: "Test Customer", line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500001", country: "IN" },
        subtotal: 500,
        shipping: 0,
        discount: 0,
        total: 500,
        currency: "INR",
        status: "PENDING_PAYMENT",
        paymentMethod: "RAZORPAY",
      },
    });
    createdOrderIds.push(paid.id, pending.id);
  });

  // F-198 fix: orderCount now counts every order (matching the order list
  // on the detail page), not just the ones that count as revenue — a
  // customer whose only order is unpaid or cancelled used to show 0
  // orders, contradicting their own order history one click away.
  // totalSpent still only counts real revenue, not N+1.
  it("computes order count from every order and total spent from PAID+ Razorpay orders only", async () => {
    const result = await listCustomersForAdmin({ search: "customer-admin-test" });
    const item = result.items.find((c) => c.id === customerId);
    assert.ok(item, "expected the test customer in the list");
    assert.equal(item!.orderCount, 2);
    assert.equal(item!.totalSpent, 1000);
  });

  it("getCustomerForAdmin returns the same aggregate plus order/review history", async () => {
    const detail = await getCustomerForAdmin(customerId);
    assert.equal(detail.orderCount, 2);
    assert.equal(detail.totalSpent, 1000);
    assert.equal(detail.orders.length, 2);
    assert.deepEqual(detail.reviews, []);
  });

  it("deactivate sets active=false and bumps sessionVersion; reactivate flips active back", async () => {
    const adminId = await findAnyAdminId();

    const deactivated = await setCustomerActive(customerId, false, adminId);
    assert.equal(deactivated.active, false);
    assert.equal(deactivated.sessionVersion, 1);

    const reactivated = await setCustomerActive(customerId, true, adminId);
    assert.equal(reactivated.active, true);
    // Reactivating doesn't need to bump it again (they'll have to log in
    // again either way once deactivated).
    assert.equal(reactivated.sessionVersion, 1);
  });

  // F-197: setCustomerActive used to return the raw Prisma `Customer` row,
  // and the PATCH route forwarded it unchanged as `{ customer }` — every
  // Deactivate/Reactivate click sent the bcrypt passwordHash and the
  // login-lockout counters to the browser. This is the actual value the
  // route serializes, so asserting on it here covers the route's response
  // shape without needing a mocked admin session (see the route-handler
  // tests below, which can only exercise the no-session path in this
  // harness).
  it("never returns passwordHash or login-lockout fields", async () => {
    const adminId = await findAnyAdminId();
    const result = await setCustomerActive(customerId, true, adminId);
    for (const forbidden of ["passwordHash", "failedLoginCount", "lockedUntil", "lastFailedLoginAt"]) {
      assert.equal(forbidden in result, false, `unexpected "${forbidden}" in setCustomerActive's result`);
    }
  });

  it("throws CustomerNotFoundError for a missing customer id", async () => {
    await assert.rejects(() => getCustomerForAdmin("does-not-exist"), CustomerNotFoundError);
    const adminId = await findAnyAdminId();
    await assert.rejects(() => setCustomerActive("does-not-exist", false, adminId), CustomerNotFoundError);
  });
});

// F-224 fix (release-hardening schema-foundation): listCustomersForAdmin
// used to load every matching customer, aggregate spend across all of
// them, then slice one page out in JS. These assert the DB-side
// count/skip/take pages correctly, and that the spend aggregate is still
// correct once it's scoped to just the current page's customer ids.
describe("customers admin pagination (F-224)", () => {
  const marker = `pagination-${randomUUID().slice(0, 8)}`;
  const pageTestCustomerIds: string[] = [];

  before(async () => {
    for (let i = 0; i < 5; i += 1) {
      const customer = await db.customer.create({
        data: {
          email: `${marker}-${i}@example.com`,
          name: `Pagination Test Customer ${marker}`,
          passwordHash: "not-a-real-hash",
          active: true,
        },
      });
      pageTestCustomerIds.push(customer.id);
      createdCustomerIds.push(customer.id);
    }
  });

  it("total/totalPages reflect the real DB count, not the current page's length", async () => {
    const result = await listCustomersForAdmin({ search: marker, pageSize: 2 });
    assert.equal(result.total, 5);
    assert.equal(result.totalPages, 3);
    assert.equal(result.items.length, 2);
  });

  it("pages are disjoint and their union covers every matching row exactly once", async () => {
    const seen = new Set<string>();
    for (let page = 1; page <= 3; page += 1) {
      const result = await listCustomersForAdmin({ search: marker, pageSize: 2, page });
      for (const item of result.items) {
        assert.ok(!seen.has(item.id), `customer ${item.id} appeared on more than one page`);
        seen.add(item.id);
      }
    }
    assert.equal(seen.size, 5);
    for (const id of pageTestCustomerIds) assert.ok(seen.has(id));
  });

  it("clamps an out-of-range page to the last page", async () => {
    const result = await listCustomersForAdmin({ search: marker, pageSize: 2, page: 999 });
    assert.equal(result.page, 3);
    assert.equal(result.items.length, 1);
  });
});

describe("customers admin routes without a session", () => {
  const idParams = Promise.resolve({ id: "any-id" });

  it("GET /api/admin/customers rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/customers");
    const response = await getCustomers(request);
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("GET /api/admin/customers/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/customers/any-id");
    const response = await getCustomer(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });

  it("PATCH /api/admin/customers/[id] rejects with 401/403", async () => {
    const request = new Request("http://localhost/api/admin/customers/any-id", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    const response = await patchCustomer(request, { params: idParams });
    assert.ok(response.status === 401 || response.status === 403);
  });
});

// F-198: SPENT_STATUSES used to include PROCESSING for *every* payment
// method, but ORDER_REQUEST orders are created straight into PROCESSING
// with no payment step at all (src/lib/orders/create-order.ts) — so an
// unpaid, just-placed order request counted as revenue the moment it was
// placed. isRevenueOrder/REVENUE_WHERE (src/lib/customers/admin-customers.ts)
// now draw the line per payment method: Razorpay counts from PAID onward
// (real capture), ORDER_REQUEST only once it has actually shipped.
describe("revenue rules per payment method (F-198)", () => {
  const marker = `revenue-${randomUUID().slice(0, 8)}`;
  let customerId: string;

  before(async () => {
    const customer = await db.customer.create({
      data: {
        email: `${marker}@example.com`,
        name: "Revenue Rules Test Customer",
        passwordHash: "not-a-real-hash",
        active: true,
      },
    });
    customerId = customer.id;
    createdCustomerIds.push(customerId);

    const baseOrder = {
      customerId,
      email: customer.email,
      shippingAddress: { name: "Test", line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500001", country: "IN" },
      subtotal: 100,
      shipping: 0,
      discount: 0,
      currency: "INR",
    };

    const [processingRequest, shippedRequest, cancelled] = await Promise.all([
      db.order.create({
        data: { ...baseOrder, number: `DK-TEST-${marker}-PROC`, total: 100, status: "PROCESSING", paymentMethod: "ORDER_REQUEST" },
      }),
      db.order.create({
        data: { ...baseOrder, number: `DK-TEST-${marker}-SHIP`, total: 200, status: "SHIPPED", paymentMethod: "ORDER_REQUEST" },
      }),
      db.order.create({
        data: { ...baseOrder, number: `DK-TEST-${marker}-CANC`, total: 300, status: "CANCELLED", paymentMethod: "RAZORPAY" },
      }),
    ]);
    createdOrderIds.push(processingRequest.id, shippedRequest.id, cancelled.id);
  });

  it("an unpaid, still-PROCESSING order request counts toward orders but not revenue", async () => {
    const result = await listCustomersForAdmin({ search: marker });
    const item = result.items.find((c) => c.id === customerId);
    assert.ok(item, "expected the test customer in the list");
    // 3 orders placed; only the SHIPPED order request counts as revenue.
    assert.equal(item!.orderCount, 3);
    assert.equal(item!.totalSpent, 200);
  });

  it("getCustomerForAdmin applies the same rule", async () => {
    const detail = await getCustomerForAdmin(customerId);
    assert.equal(detail.orderCount, 3);
    assert.equal(detail.totalSpent, 200);
  });
});

// F-198: guest checkouts (no Customer account) never appeared anywhere in
// /admin/customers, even though most orders at this store are guest
// orders — listGuestBuyersForAdmin aggregates them by email instead.
describe("listGuestBuyersForAdmin (F-198)", () => {
  const marker = `guest-${randomUUID().slice(0, 8)}`;
  const guestEmail = `${marker}@example.com`;

  before(async () => {
    const baseOrder = {
      email: guestEmail,
      customerId: null,
      shippingAddress: { name: "Guest", line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500001", country: "IN" },
      subtotal: 100,
      shipping: 0,
      discount: 0,
      currency: "INR",
    };
    const [delivered, pending] = await Promise.all([
      db.order.create({
        data: { ...baseOrder, number: `DK-TEST-${marker}-DEL`, total: 400, status: "DELIVERED", paymentMethod: "RAZORPAY" },
      }),
      db.order.create({
        data: { ...baseOrder, number: `DK-TEST-${marker}-PEND`, total: 500, status: "PENDING_PAYMENT", paymentMethod: "RAZORPAY" },
      }),
    ]);
    createdOrderIds.push(delivered.id, pending.id);
  });

  it("aggregates guest orders by email, with orderCount over all orders and totalSpent over revenue only", async () => {
    const result = await listGuestBuyersForAdmin({ search: marker });
    assert.equal(result.items.length, 1);
    const guest = result.items[0];
    assert.equal(guest.email, guestEmail);
    assert.equal(guest.orderCount, 2);
    assert.equal(guest.totalSpent, 400);
  });

  it("never includes an order that has a customerId", async () => {
    // The very first describe block's customer has real orders; make sure
    // a search matching *their* email doesn't pull them in here.
    const result = await listGuestBuyersForAdmin({ search: "customer-admin-test" });
    assert.equal(result.items.length, 0);
  });
});
