import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getOrderStatusLabel } from "@/components/account/order-status-badge";
import { orderStatusValues } from "@/lib/orders/admin-orders";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

/**
 * F-140 fix: the customer order badge used to special-case only
 * PENDING_PAYMENT + ORDER_REQUEST, but create-order.ts puts an
 * ORDER_REQUEST order straight into PROCESSING — so the special case
 * never actually fired, and the badge read "PROCESSING" while the
 * timeline right below it (getOrderTimeline) said "Awaiting confirmation"
 * for the same order. This repo's unit tests run under Node's test
 * runner with no DOM (see product-view-tracker.test.ts), so this exercises
 * the pulled-out pure `getOrderStatusLabel` directly rather than rendering
 * the badge component.
 */
describe("getOrderStatusLabel", () => {
  it("reads an ORDER_REQUEST order in PROCESSING as 'Order Received', matching getOrderTimeline's 'Awaiting confirmation'", () => {
    assert.equal(getOrderStatusLabel("PROCESSING", "ORDER_REQUEST"), "Order Received");
  });

  it("still reads an ORDER_REQUEST order in PENDING_PAYMENT as 'Order Received'", () => {
    assert.equal(getOrderStatusLabel("PENDING_PAYMENT", "ORDER_REQUEST"), "Order Received");
  });

  it("a RAZORPAY order in the same statuses reads its plain status label, never 'Order Received'", () => {
    assert.equal(getOrderStatusLabel("PENDING_PAYMENT", "RAZORPAY"), "Awaiting Payment");
    assert.equal(getOrderStatusLabel("PROCESSING", "RAZORPAY"), "Processing");
  });

  it("an ORDER_REQUEST order past PROCESSING reads its plain status label, not 'Order Received'", () => {
    assert.equal(getOrderStatusLabel("SHIPPED", "ORDER_REQUEST"), "Shipped");
    assert.equal(getOrderStatusLabel("DELIVERED", "ORDER_REQUEST"), "Delivered");
  });

  // F-199 fix: an admin can now record an order-request's payment
  // (PROCESSING -> PAID), after which it may go back to PROCESSING to be
  // packed — it must not read "Order Received" (unconfirmed) again then.
  it("an ORDER_REQUEST order whose payment has been recorded reads its plain status, never 'Order Received'", () => {
    assert.equal(getOrderStatusLabel("PROCESSING", "ORDER_REQUEST", true), "Processing");
    assert.equal(getOrderStatusLabel("PAID", "ORDER_REQUEST", true), "Paid");
    assert.equal(getOrderStatusLabel("PROCESSING", "ORDER_REQUEST", false), "Order Received");
  });

  it("reads RETURNED and REFUNDED plainly for an order-request, paid or not", () => {
    for (const paid of [true, false]) {
      assert.equal(getOrderStatusLabel("RETURNED", "ORDER_REQUEST", paid), "Returned");
      assert.equal(getOrderStatusLabel("REFUNDED", "ORDER_REQUEST", paid), "Refunded");
    }
  });

  it("covers every OrderStatus value without throwing, for both payment methods", () => {
    for (const status of orderStatusValues) {
      for (const paymentMethod of ["RAZORPAY", "ORDER_REQUEST"] as const) {
        const label = getOrderStatusLabel(status, paymentMethod);
        assert.ok(label.length > 0, `${status}/${paymentMethod} should render a label`);
      }
    }
  });

  it("exhaustively covers the real prisma OrderStatus enum (fails loudly if the schema adds a new value)", () => {
    const covered: OrderStatus[] = [
      "PENDING_PAYMENT",
      "PAID",
      "PROCESSING",
      "SHIPPED",
      "DELIVERED",
      "CANCELLED",
      "REFUNDED",
      "RETURNED",
    ];
    assert.deepEqual([...orderStatusValues].sort(), [...covered].sort());
    for (const status of covered) {
      assert.doesNotThrow(() => getOrderStatusLabel(status, "RAZORPAY" satisfies PaymentMethod));
    }
  });
});
