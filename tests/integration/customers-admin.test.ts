import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { CustomerNotFoundError, getCustomerForAdmin, listCustomersForAdmin, setCustomerActive } from "@/lib/customers/admin-customers";
import { GET as getCustomers } from "@/app/api/admin/customers/route";
import { GET as getCustomer, PATCH as patchCustomer } from "@/app/api/admin/customers/[id]/route";

/**
 * Phase D4: customers admin service layer (list aggregation, detail,
 * active/inactive toggle + sessionVersion revocation) plus a 401/403
 * check on every route handler. Same route-handler constraint as
 * tests/integration/catalog-admin.test.ts and orders-admin.test.ts.
 */

async function findAnyAdminId(): Promise<string> {
  const user = await db.user.findFirst({ select: { id: true } });
  assert.ok(user, "expected at least one admin user to exist in the database");
  return user.id;
}

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

  it("computes order count and total spent from PAID+ orders only, not N+1", async () => {
    const result = await listCustomersForAdmin({ search: "customer-admin-test" });
    const item = result.items.find((c) => c.id === customerId);
    assert.ok(item, "expected the test customer in the list");
    assert.equal(item!.orderCount, 1);
    assert.equal(item!.totalSpent, 1000);
  });

  it("getCustomerForAdmin returns the same aggregate plus order/review history", async () => {
    const detail = await getCustomerForAdmin(customerId);
    assert.equal(detail.orderCount, 1);
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

  it("throws CustomerNotFoundError for a missing customer id", async () => {
    await assert.rejects(() => getCustomerForAdmin("does-not-exist"), CustomerNotFoundError);
    const adminId = await findAnyAdminId();
    await assert.rejects(() => setCustomerActive("does-not-exist", false, adminId), CustomerNotFoundError);
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
