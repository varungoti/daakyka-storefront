import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { linkGuestOrdersToCustomer } from "@/lib/orders/claim-guest-orders";

/**
 * Release-hardening F-01 / plan item 1.4: linkGuestOrdersToCustomer is the
 * "claim" half of "don't mint a Customer for guest checkout" — it attaches
 * already-placed guest orders (Order.customerId === null) to a
 * newly-registered or returning Customer by matching email, without ever
 * touching the order's own email/phone/shippingAddress.
 */

const createdOrderIds: string[] = [];
const createdCustomerIds: string[] = [];

after(async () => {
  if (createdOrderIds.length > 0) {
    await db.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
  }
  if (createdCustomerIds.length > 0) {
    await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => {});
  }
});

function guestOrderData(overrides: { number: string; email: string; customerId?: string | null }) {
  return {
    number: overrides.number,
    customerId: overrides.customerId ?? null,
    email: overrides.email,
    phone: "9876543210",
    shippingAddress: { name: "Claim Test Buyer", line1: "1 Test St", city: "Hyderabad", state: "TG", pincode: "500001", country: "IN" },
    subtotal: 500,
    shipping: 0,
    discount: 0,
    total: 500,
    currency: "INR",
    status: "PAID" as const,
    paymentMethod: "ORDER_REQUEST" as const,
  };
}

describe("linkGuestOrdersToCustomer (F-01 claim mechanism)", () => {
  it("attaches an unclaimed guest order matching the email, case-insensitively", async () => {
    const unique = randomUUID().slice(0, 8);
    const email = `Claim-Test-${unique}@Example.com`;

    const guestOrder = await db.order.create({
      data: guestOrderData({ number: `DK-CLAIM-${unique}`, email }),
    });
    createdOrderIds.push(guestOrder.id);

    const customer = await db.customer.create({
      data: { email: email.toLowerCase(), name: "Claim Test", passwordHash: "x" },
    });
    createdCustomerIds.push(customer.id);

    const linked = await linkGuestOrdersToCustomer(customer.id, customer.email);
    assert.equal(linked, 1);

    const updated = await db.order.findUnique({ where: { id: guestOrder.id } });
    assert.equal(updated?.customerId, customer.id);
    // The claim must never rewrite the order's own real contact details.
    assert.equal(updated?.email, email);
  });

  it("claims every unclaimed order for that email, not just one", async () => {
    const unique = randomUUID().slice(0, 8);
    const email = `claim-multi-${unique}@example.com`;

    const first = await db.order.create({ data: guestOrderData({ number: `DK-CLAIM-A-${unique}`, email }) });
    const second = await db.order.create({ data: guestOrderData({ number: `DK-CLAIM-B-${unique}`, email }) });
    createdOrderIds.push(first.id, second.id);

    const customer = await db.customer.create({ data: { email, name: "Claim Multi", passwordHash: "x" } });
    createdCustomerIds.push(customer.id);

    const linked = await linkGuestOrdersToCustomer(customer.id, email);
    assert.equal(linked, 2);
  });

  it("never touches an order already linked to a different customer", async () => {
    const unique = randomUUID().slice(0, 8);
    const email = `claim-owned-${unique}@example.com`;

    const otherCustomer = await db.customer.create({
      data: { email: `other-${unique}@example.com`, name: "Other Owner", passwordHash: "x" },
    });
    createdCustomerIds.push(otherCustomer.id);

    const alreadyLinked = await db.order.create({
      data: guestOrderData({ number: `DK-CLAIM-OWNED-${unique}`, email, customerId: otherCustomer.id }),
    });
    createdOrderIds.push(alreadyLinked.id);

    const newCustomer = await db.customer.create({ data: { email, name: "New Registrant", passwordHash: "x" } });
    createdCustomerIds.push(newCustomer.id);

    const linked = await linkGuestOrdersToCustomer(newCustomer.id, email);
    assert.equal(linked, 0, "an order already owned by another customer must never be reassigned");

    const unchanged = await db.order.findUnique({ where: { id: alreadyLinked.id } });
    assert.equal(unchanged?.customerId, otherCustomer.id);
  });

  it("does not claim an unrelated email's guest order", async () => {
    const unique = randomUUID().slice(0, 8);
    const unrelatedOrder = await db.order.create({
      data: guestOrderData({ number: `DK-CLAIM-UNRELATED-${unique}`, email: `unrelated-${unique}@example.com` }),
    });
    createdOrderIds.push(unrelatedOrder.id);

    const customer = await db.customer.create({
      data: { email: `claimer-${unique}@example.com`, name: "Claimer", passwordHash: "x" },
    });
    createdCustomerIds.push(customer.id);

    const linked = await linkGuestOrdersToCustomer(customer.id, customer.email);
    assert.equal(linked, 0);

    const unchanged = await db.order.findUnique({ where: { id: unrelatedOrder.id } });
    assert.equal(unchanged?.customerId, null);
  });

  it("is a no-op for a blank email or id", async () => {
    assert.equal(await linkGuestOrdersToCustomer("some-id", "   "), 0);
    assert.equal(await linkGuestOrdersToCustomer("", "someone@example.com"), 0);
  });
});
