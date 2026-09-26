import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  ensureInvoiceNumber,
  financialYearLabel,
  isInvoiceEligible,
} from "@/lib/orders/invoice-number";

/**
 * release-hardening F-195: `ensureInvoiceNumber` assigns a real, sequential
 * GST invoice serial the first time an order's invoice is viewed, but only
 * once the order has actually reached a "this was sold" status — see that
 * module's own doc comment for why it's assigned lazily here rather than at
 * the PAID-transition call site.
 */

function orderData(overrides: { number: string; status: "PENDING_PAYMENT" | "PAID" | "SHIPPED" | "CANCELLED" }) {
  return {
    number: overrides.number,
    email: `invoice-test-${overrides.number}@example.com`,
    shippingAddress: { name: "Invoice Test Buyer", line1: "1 Test St", city: "Hyderabad", state: "Telangana", pincode: "500001", country: "IN" },
    subtotal: 500,
    shipping: 0,
    discount: 0,
    total: 500,
    currency: "INR",
    status: overrides.status,
    paymentMethod: "RAZORPAY" as const,
  };
}

describe("financialYearLabel (F-195)", () => {
  it("labels a date in April as the start of a new financial year", () => {
    assert.equal(financialYearLabel(new Date(2026, 3, 1)), "2026-27");
  });

  it("labels a date in March as still the previous financial year", () => {
    assert.equal(financialYearLabel(new Date(2027, 2, 31)), "2026-27");
  });

  it("rolls over the two-digit end year at the turn of a century boundary", () => {
    assert.equal(financialYearLabel(new Date(2099, 3, 1)), "2099-00");
  });
});

describe("isInvoiceEligible (F-195)", () => {
  it("is true for PAID, PROCESSING, SHIPPED and DELIVERED", () => {
    for (const status of ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const) {
      assert.equal(isInvoiceEligible(status), true);
    }
  });

  it("is false for PENDING_PAYMENT, CANCELLED and REFUNDED", () => {
    for (const status of ["PENDING_PAYMENT", "CANCELLED", "REFUNDED"] as const) {
      assert.equal(isInvoiceEligible(status), false);
    }
  });
});

describe("ensureInvoiceNumber (F-195)", () => {
  const createdOrderIds: string[] = [];

  after(async () => {
    if (createdOrderIds.length > 0) {
      await db.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
    }
  });

  it("returns null, and assigns nothing, for a PENDING_PAYMENT order", async () => {
    const unique = randomUUID().slice(0, 8);
    const order = await db.order.create({ data: orderData({ number: `INV-PEND-${unique}`, status: "PENDING_PAYMENT" }) });
    createdOrderIds.push(order.id);

    const result = await ensureInvoiceNumber(order.id);
    assert.equal(result, null);

    const row = await db.order.findUnique({ where: { id: order.id } });
    assert.equal(row?.invoiceNumber, null);
  });

  it("returns null for a CANCELLED order", async () => {
    const unique = randomUUID().slice(0, 8);
    const order = await db.order.create({ data: orderData({ number: `INV-CANC-${unique}`, status: "CANCELLED" }) });
    createdOrderIds.push(order.id);

    assert.equal(await ensureInvoiceNumber(order.id), null);
  });

  it("assigns a DK/<FY>/###### number for a PAID order, and returns the same number on a second call", async () => {
    const unique = randomUUID().slice(0, 8);
    const order = await db.order.create({ data: orderData({ number: `INV-PAID-${unique}`, status: "PAID" }) });
    createdOrderIds.push(order.id);

    const first = await ensureInvoiceNumber(order.id);
    assert.ok(first, "expected a real invoice number");
    assert.match(first!, /^DK\/\d{4}-\d{2}\/\d{6}$/);

    const second = await ensureInvoiceNumber(order.id);
    assert.equal(second, first, "a second call must not reassign or bump the number");

    const row = await db.order.findUnique({ where: { id: order.id } });
    assert.equal(row?.invoiceNumber, first);
  });

  it("assigns strictly increasing, gap-free numbers within the same financial year for concurrent orders", async () => {
    const unique = randomUUID().slice(0, 8);
    const orders = await Promise.all(
      [0, 1, 2].map((i) => db.order.create({ data: orderData({ number: `INV-CONC-${unique}-${i}`, status: "SHIPPED" }) })),
    );
    createdOrderIds.push(...orders.map((o) => o.id));

    const numbers = await Promise.all(orders.map((o) => ensureInvoiceNumber(o.id)));
    for (const n of numbers) assert.ok(n);

    const sequences = numbers.map((n) => Number(n!.split("/")[2]));
    const uniqueSequences = new Set(sequences);
    assert.equal(uniqueSequences.size, 3, "every concurrently-assigned order must get its own sequence number");
  });
});
