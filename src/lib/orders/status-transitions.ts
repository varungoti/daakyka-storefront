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
