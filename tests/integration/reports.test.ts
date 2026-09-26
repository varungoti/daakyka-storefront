import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { getCommerceStats } from "@/lib/reports/weekly-growth";
import type { Prisma } from "@/generated/prisma/client";

/**
 * F-058: buildWeeklyGrowthReport (and the weekly cron that posts it into
 * admin notifications) used to read the legacy Shopify-webhook OrderEvent
 * table, which this store's native checkout never writes to — so the admin
 * Reports page always showed 0 orders / ₹0 revenue no matter how many real
 * orders came in. getCommerceStats() now reads the native Order table
 * instead. src/lib/reports/weekly-growth.test.ts unit-tests it by stubbing
 * db.order.aggregate; this test seeds real Order rows in Postgres to prove
 * the actual query (status filter + Decimal(10,2) summation) behaves
 * correctly end to end, the way weekly-growth.test.ts's stub can't.
 */

const createdOrderIds: string[] = [];

function orderData(overrides: Partial<Prisma.OrderUncheckedCreateInput>): Prisma.OrderUncheckedCreateInput {
  return {
    number: `DK-F058-${Math.random().toString(36).slice(2, 10)}`,
    email: "f058-reports-test@example.com",
    shippingAddress: {
      name: "Test Buyer",
      line1: "1 Test St",
      city: "Hyderabad",
      state: "TG",
      pincode: "500001",
      country: "IN",
    },
    subtotal: 1000,
    shipping: 99,
    discount: 0,
    total: 1099,
    currency: "INR",
    status: "PENDING_PAYMENT",
    paymentMethod: "RAZORPAY",
    ...overrides,
  };
}

after(async () => {
  if (createdOrderIds.length > 0) {
    await db.order.deleteMany({ where: { id: { in: createdOrderIds } } }).catch(() => {});
  }
});

describe("getCommerceStats against the native Order table", () => {
  it("counts PAID/PROCESSING/SHIPPED/DELIVERED orders and sums their Decimal totals, excluding PENDING_PAYMENT/CANCELLED/REFUNDED", async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Two ORDER_REQUEST bookings (this store's checkout fallback whenever
    // Razorpay isn't configured — see create-order.ts) go straight to
    // PROCESSING without ever being paid online, and one Razorpay order
    // reaches DELIVERED. All three must count.
    const included = await Promise.all([
      db.order.create({
        data: orderData({ status: "PROCESSING", paymentMethod: "ORDER_REQUEST", total: 500, subtotal: 401, shipping: 99 }),
      }),
      db.order.create({
        data: orderData({ status: "PROCESSING", paymentMethod: "ORDER_REQUEST", total: 750.5, subtotal: 651.5, shipping: 99 }),
      }),
      db.order.create({
        data: orderData({ status: "DELIVERED", paymentMethod: "RAZORPAY", total: 2000, subtotal: 1901, shipping: 99 }),
      }),
    ]);

    // None of these represent a completed or booked sale and must be
    // excluded — this is the exact CANCELLED-order scenario from F-058's
    // evidence (₹35k of CANCELLED orders more than doubling the figure).
    const excluded = await Promise.all([
      db.order.create({ data: orderData({ status: "PENDING_PAYMENT", total: 999999 }) }),
      db.order.create({ data: orderData({ status: "CANCELLED", total: 999999 }) }),
      db.order.create({ data: orderData({ status: "REFUNDED", total: 999999 }) }),
    ]);

    createdOrderIds.push(...included.map((o) => o.id), ...excluded.map((o) => o.id));

    const stats = await getCommerceStats(since);

    assert.ok(stats.orders >= 3, `expected at least the 3 seeded reportable orders, got ${stats.orders}`);
    assert.ok(
      stats.revenueInr >= 3250.5,
      `expected revenue to include at least 500 + 750.5 + 2000 = 3250.5, got ${stats.revenueInr}`,
    );
    // The three excluded orders are ₹999,999 each — if any leaked in, the
    // total would be off by roughly a million rupees, not a rounding error.
    assert.ok(
      stats.revenueInr < 900000,
      `PENDING_PAYMENT/CANCELLED/REFUNDED orders must not be counted as revenue, got ${stats.revenueInr}`,
    );
  });

  it("only counts orders created within the requested window", async () => {
    // A distinctive, unlikely-to-collide total so this order's presence or
    // absence in the sum is unambiguous regardless of what else is seeded.
    const distinctiveTotal = 424242.42;
    const old = await db.order.create({
      data: orderData({ status: "PAID", total: distinctiveTotal, createdAt: new Date("2020-01-01T00:00:00.000Z") }),
    });
    createdOrderIds.push(old.id);

    const statsLastHour = await getCommerceStats(new Date(Date.now() - 60 * 60 * 1000));
    assert.ok(
      statsLastHour.revenueInr < distinctiveTotal,
      "a 2020 order must not be counted by a 'since the last hour' window",
    );

    const statsSince2019 = await getCommerceStats(new Date("2019-01-01T00:00:00.000Z"));
    assert.ok(statsSince2019.orders >= 1);
    assert.ok(statsSince2019.revenueInr >= distinctiveTotal);
  });
});
