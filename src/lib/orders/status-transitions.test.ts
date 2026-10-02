import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";
import {
  assertValidOrderStatusTransition,
  canRecordOrderRequestPayment,
  InvalidOrderStatusTransitionError,
  isPaymentRecordableStatus,
  isValidOrderStatusTransition,
  orderHoldsReservedStock,
  orderStatusTimestampField,
  ORDER_STATUS_TRANSITIONS,
} from "@/lib/orders/status-transitions";

const ALL_STATUSES: OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
  "RETURNED",
];

describe("order status transition matrix (Phase D4)", () => {
  it("covers every OrderStatus as a key", () => {
    for (const status of ALL_STATUSES) {
      assert.ok(status in ORDER_STATUS_TRANSITIONS, `missing matrix entry for ${status}`);
    }
  });

  const validCases: [OrderStatus, OrderStatus][] = [
    ["PENDING_PAYMENT", "PAID"],
    ["PENDING_PAYMENT", "CANCELLED"],
    ["PAID", "PROCESSING"],
    ["PAID", "REFUNDED"],
    ["PAID", "CANCELLED"],
    ["PROCESSING", "SHIPPED"],
    ["PROCESSING", "CANCELLED"],
    // F-199 fix: records an order-request's payment (admin-orders.ts
    // further restricts *using* this edge to ORDER_REQUEST orders only).
    ["PROCESSING", "PAID"],
    ["SHIPPED", "DELIVERED"],
    // F-199 fix: a shipped or delivered order can be marked returned, and
    // a return can then be marked refunded...
    ["SHIPPED", "RETURNED"],
    ["DELIVERED", "RETURNED"],
    ["RETURNED", "REFUNDED"],
    // ...or refunded outright with no return (lost in transit, goodwill) —
    // the move the Razorpay refund webhook already makes.
    ["SHIPPED", "REFUNDED"],
    ["DELIVERED", "REFUNDED"],
  ];

  for (const [from, to] of validCases) {
    it(`allows ${from} -> ${to}`, () => {
      assert.equal(isValidOrderStatusTransition(from, to), true);
      assert.doesNotThrow(() => assertValidOrderStatusTransition(from, to));
    });
  }

  const invalidCases: [OrderStatus, OrderStatus][] = [
    ["DELIVERED", "PENDING_PAYMENT"],
    ["DELIVERED", "CANCELLED"],
    ["SHIPPED", "CANCELLED"],
    ["SHIPPED", "PROCESSING"],
    ["CANCELLED", "PAID"],
    ["REFUNDED", "PAID"],
    ["PENDING_PAYMENT", "SHIPPED"],
    ["PENDING_PAYMENT", "DELIVERED"],
    ["PAID", "PENDING_PAYMENT"],
    ["PAID", "SHIPPED"],
    ["PAID", "DELIVERED"],
    ["PROCESSING", "PENDING_PAYMENT"],
    ["PROCESSING", "DELIVERED"],
    ["SHIPPED", "SHIPPED"],
    // F-199 fix: RETURNED is reachable only from SHIPPED/DELIVERED, and
    // only leads to REFUNDED — never a cancellation, never a second
    // return, and never reachable from a status that skipped shipping.
    ["PENDING_PAYMENT", "RETURNED"],
    ["PROCESSING", "RETURNED"],
    ["PAID", "RETURNED"],
    ["CANCELLED", "RETURNED"],
    ["REFUNDED", "RETURNED"],
    ["RETURNED", "CANCELLED"],
    ["RETURNED", "DELIVERED"],
    ["RETURNED", "RETURNED"],
  ];

  for (const [from, to] of invalidCases) {
    it(`rejects ${from} -> ${to}`, () => {
      assert.equal(isValidOrderStatusTransition(from, to), false);
      assert.throws(() => assertValidOrderStatusTransition(from, to), InvalidOrderStatusTransitionError);
    });
  }

  it("rejects a same-status no-op transition for every status", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(isValidOrderStatusTransition(status, status), false);
    }
  });

  it("throws an error carrying the from/to statuses", () => {
    try {
      assertValidOrderStatusTransition("DELIVERED", "PENDING_PAYMENT");
      assert.fail("expected a throw");
    } catch (err) {
      assert.ok(err instanceof InvalidOrderStatusTransitionError);
      assert.equal(err.from, "DELIVERED");
      assert.equal(err.to, "PENDING_PAYMENT");
    }
  });
});

describe("F-199: the order-request payment and post-delivery return journeys", () => {
  it("an order-request (created in PROCESSING) can be marked paid, then packed and shipped like any paid order", () => {
    // PROCESSING -> PAID records the payment; PAID -> PROCESSING resumes
    // the normal fulfilment line from there.
    assert.equal(isValidOrderStatusTransition("PROCESSING", "PAID"), true);
    assert.equal(isValidOrderStatusTransition("PAID", "PROCESSING"), true);
    assert.equal(isValidOrderStatusTransition("PROCESSING", "SHIPPED"), true);
  });

  it("a delivered order can be returned, and the return then refunded", () => {
    assert.equal(isValidOrderStatusTransition("DELIVERED", "RETURNED"), true);
    assert.equal(isValidOrderStatusTransition("RETURNED", "REFUNDED"), true);
  });

  it("every status reachable from DELIVERED/SHIPPED is a post-shipping outcome, never an earlier step", () => {
    for (const from of ["SHIPPED", "DELIVERED"] as const) {
      for (const to of ORDER_STATUS_TRANSITIONS[from]) {
        assert.ok(["DELIVERED", "RETURNED", "REFUNDED"].includes(to), `${from} -> ${to}`);
      }
    }
  });

  it("only CANCELLED and REFUNDED are final", () => {
    const finalStatuses = ALL_STATUSES.filter((status) => ORDER_STATUS_TRANSITIONS[status].length === 0);
    assert.deepEqual([...finalStatuses].sort(), ["CANCELLED", "REFUNDED"]);
  });
});

describe("orderHoldsReservedStock (F-199: refunding after shipping must not add phantom stock)", () => {
  const methods: PaymentMethod[] = ["RAZORPAY", "ORDER_REQUEST"];

  it("stock is reserved for a paid or processing order, whichever payment method it used", () => {
    for (const method of methods) {
      assert.equal(orderHoldsReservedStock(method, "PAID"), true, `${method} PAID`);
      assert.equal(orderHoldsReservedStock(method, "PROCESSING"), true, `${method} PROCESSING`);
    }
  });

  it("an order-request marked paid (PROCESSING -> PAID) still holds its checkout-time stock, so cancelling or refunding it from PAID restores it", () => {
    assert.equal(orderHoldsReservedStock("ORDER_REQUEST", "PAID"), true);
  });

  it("an unpaid RAZORPAY checkout hasn't taken stock yet; a legacy ORDER_REQUEST in PENDING_PAYMENT had it taken at creation", () => {
    assert.equal(orderHoldsReservedStock("RAZORPAY", "PENDING_PAYMENT"), false);
    assert.equal(orderHoldsReservedStock("ORDER_REQUEST", "PENDING_PAYMENT"), true);
  });

  it("nothing is reserved once an order has shipped, been returned, or reached a final status", () => {
    for (const method of methods) {
      for (const status of ["SHIPPED", "DELIVERED", "RETURNED", "CANCELLED", "REFUNDED"] as const) {
        assert.equal(orderHoldsReservedStock(method, status), false, `${method} ${status}`);
      }
    }
  });
});

describe("canRecordOrderRequestPayment (F-199: a cash-on-delivery order is paid after it ships)", () => {
  it("an unpaid order-request can have its payment recorded while Processing, Shipped or Delivered", () => {
    for (const status of ["PROCESSING", "SHIPPED", "DELIVERED"] as const) {
      assert.equal(canRecordOrderRequestPayment("ORDER_REQUEST", status, false), true, status);
      assert.equal(isPaymentRecordableStatus(status), true, status);
    }
  });

  it("SHIPPED and DELIVERED have no PAID edge — recording a payment there must not depend on one", () => {
    assert.equal(isValidOrderStatusTransition("SHIPPED", "PAID"), false);
    assert.equal(isValidOrderStatusTransition("DELIVERED", "PAID"), false);
    assert.equal(canRecordOrderRequestPayment("ORDER_REQUEST", "SHIPPED", false), true);
    assert.equal(canRecordOrderRequestPayment("ORDER_REQUEST", "DELIVERED", false), true);
  });

  it("never once a payment is recorded, and never for a RAZORPAY order (its payment is captured online)", () => {
    for (const status of ALL_STATUSES) {
      assert.equal(canRecordOrderRequestPayment("ORDER_REQUEST", status, true), false, `recorded ${status}`);
      assert.equal(canRecordOrderRequestPayment("RAZORPAY", status, false), false, `razorpay ${status}`);
    }
  });

  it("never for an order with no money to record: cancelled, refunded, returned, or still awaiting payment/PAID (the status move records those)", () => {
    for (const status of ["PENDING_PAYMENT", "PAID", "CANCELLED", "REFUNDED", "RETURNED"] as const) {
      assert.equal(canRecordOrderRequestPayment("ORDER_REQUEST", status, false), false, status);
      assert.equal(isPaymentRecordableStatus(status), false, status);
    }
  });
});

describe("orderStatusTimestampField (F-334)", () => {
  it("maps each status that has a dedicated Order column", () => {
    assert.equal(orderStatusTimestampField("PAID"), "paidAt");
    assert.equal(orderStatusTimestampField("SHIPPED"), "shippedAt");
    assert.equal(orderStatusTimestampField("DELIVERED"), "deliveredAt");
    assert.equal(orderStatusTimestampField("CANCELLED"), "cancelledAt");
  });

  it("returns null for statuses with no dedicated column", () => {
    assert.equal(orderStatusTimestampField("PENDING_PAYMENT"), null);
    assert.equal(orderStatusTimestampField("PROCESSING"), null);
    assert.equal(orderStatusTimestampField("REFUNDED"), null);
    assert.equal(orderStatusTimestampField("RETURNED"), null);
  });

  it("covers every OrderStatus without throwing", () => {
    for (const status of ALL_STATUSES) {
      assert.doesNotThrow(() => orderStatusTimestampField(status));
    }
  });
});
