import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { OrderStatus } from "@/generated/prisma/client";
import {
  assertValidOrderStatusTransition,
  InvalidOrderStatusTransitionError,
  isValidOrderStatusTransition,
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
    ["SHIPPED", "DELIVERED"],
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
    ["PROCESSING", "PAID"],
    ["PROCESSING", "PENDING_PAYMENT"],
    ["PROCESSING", "DELIVERED"],
    ["SHIPPED", "SHIPPED"],
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
