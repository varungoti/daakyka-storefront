import type { OrderStatus } from "@/generated/prisma/client";

/**
 * Phase D4: admin order-status transition matrix.
 *
 * A small, explicit adjacency list rather than a generic "is this a
 * forward move" rule, because the real lifecycle isn't linear: PAID can
 * go to REFUNDED without ever being SHIPPED, and CANCELLED is reachable
 * from every pre-shipped state but never after SHIPPED/DELIVERED. Kept as
 * a pure function (no DB import) so it's unit-testable as a matrix
 * without a database.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: ["PROCESSING", "REFUNDED", "CANCELLED"],
  PROCESSING: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
  REFUNDED: [],
  // release-hardening schema-foundation (wave 1): the OrderStatus enum
  // value exists (F-199, see prisma/schema.prisma) but no transition
  // into or out of it is wired up yet — that's wave-4's
  // order-status-workflow-and-timeline package. An empty array here is
  // just what every other terminal-for-now state above already has.
  RETURNED: [],
};

export class InvalidOrderStatusTransitionError extends Error {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
  ) {
    super(`Cannot move an order from ${from} to ${to}`);
    this.name = "InvalidOrderStatusTransitionError";
  }
}

/** True when moving directly from `from` to `to` is allowed. A no-op
 * (`from === to`) is never a valid "transition" — callers that only want
 * to update tracking/adminNotes should simply omit `status` instead. */
export function isValidOrderStatusTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertValidOrderStatusTransition(from: OrderStatus, to: OrderStatus): void {
  if (!isValidOrderStatusTransition(from, to)) {
    throw new InvalidOrderStatusTransitionError(from, to);
  }
}

/**
 * F-334 fix: which `Order` timestamp column records the moment a status
 * was reached, if any. The single source of truth for every place
 * `Order.status` is actually written — src/lib/orders/admin-orders.ts's
 * `updateOrderAdmin` (PAID/SHIPPED/DELIVERED/CANCELLED via the admin),
 * src/app/api/checkout/verify/route.ts and src/app/api/webhooks/razorpay/
 * route.ts (PAID via the payment provider) — so a column always means the
 * same thing regardless of which of those call sites set it. Returns
 * `null` for a status with no dedicated column (PENDING_PAYMENT,
 * PROCESSING, REFUNDED, RETURNED) — nothing should be written for those.
 */
export function orderStatusTimestampField(
  status: OrderStatus,
): "paidAt" | "shippedAt" | "deliveredAt" | "cancelledAt" | null {
  switch (status) {
    case "PAID":
      return "paidAt";
    case "SHIPPED":
      return "shippedAt";
    case "DELIVERED":
      return "deliveredAt";
    case "CANCELLED":
      return "cancelledAt";
    default:
      return null;
  }
}
