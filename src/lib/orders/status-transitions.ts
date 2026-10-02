import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

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
  // F-199 fix: PROCESSING -> PAID exists only so an admin can record that
  // an order-request (UPI/bank transfer/COD — no online payment step) has
  // actually been paid. create-order.ts puts an ORDER_REQUEST order
  // straight into PROCESSING with no PAID step behind it, so before this
  // there was no way to ever record the payment — see admin-orders.ts's
  // updateOrderAdmin, which further restricts *using* this edge to
  // ORDER_REQUEST orders with no payment recorded yet (a RAZORPAY order
  // only ever reaches PROCESSING by having already passed through PAID,
  // so it has nothing to "record"). The status-less way to record a
  // payment (canRecordOrderRequestPayment, below) covers the rest —
  // notably an order-request paid after it has shipped (cash on delivery),
  // which has no PAID edge to go through.
  PROCESSING: ["SHIPPED", "CANCELLED", "PAID"],
  // F-199 fix: once an order has shipped the ways out are a return (the
  // goods came back: RETURNED, then REFUNDED once the money has gone back)
  // or a refund with no return at all (lost in transit, a goodwill refund:
  // straight to REFUNDED — the same SHIPPED/DELIVERED -> REFUNDED move the
  // Razorpay refund webhook already makes). CANCELLED stays unreachable
  // from here: a cancellation means "never shipped".
  SHIPPED: ["DELIVERED", "RETURNED", "REFUNDED"],
  DELIVERED: ["RETURNED", "REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
  // F-199 fix: previously unreachable (wave-1 schema-foundation only added
  // the enum value). Reachable from SHIPPED or DELIVERED (above);
  // RETURNED -> REFUNDED is the deliberate second step, since "the parcel
  // is back" and "the money is back" don't always happen at the same time.
  RETURNED: ["REFUNDED"],
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

/**
 * Whether the stock (and discount redemption) an order took out of
 * inventory is still reserved for it in `status` — i.e. cancelling or
 * refunding it from here must give it back. The single definition shared
 * by updateOrderAdmin (which actually restocks) and the admin order form
 * (whose confirmation prompt promises the restock), so the two can't
 * drift apart.
 *
 * An ORDER_REQUEST order takes stock at checkout; a RAZORPAY order takes
 * it at its PAID transition (verify/webhook, or the manual
 * PENDING_PAYMENT -> PAID). Either way it stays reserved through
 * PAID/PROCESSING and stops being reserved the moment the order ships:
 * after that the goods are with the customer, so refunding a
 * SHIPPED/DELIVERED/RETURNED order must never silently add phantom stock
 * back — whether returned goods are sellable again is a separate,
 * deliberate choice (updateOrderAdmin's `restockReturnedItems`).
 */
export function orderHoldsReservedStock(paymentMethod: PaymentMethod, status: OrderStatus): boolean {
  switch (status) {
    case "PAID":
    case "PROCESSING":
      return true;
    case "PENDING_PAYMENT":
      // A RAZORPAY order hasn't taken stock yet; a legacy ORDER_REQUEST row
      // left in PENDING_PAYMENT already had it decremented at creation.
      return paymentMethod === "ORDER_REQUEST";
    default:
      return false;
  }
}

/**
 * F-199 fix: the statuses in which an ORDER_REQUEST order's payment can be
 * recorded without the PAID status (see canRecordOrderRequestPayment) —
 * also the only statuses such an update may leave the order in, so
 * recording a payment is never combined with a move to
 * CANCELLED/REFUNDED/RETURNED, where there is no payment to record.
 */
export function isPaymentRecordableStatus(status: OrderStatus): boolean {
  return status === "PROCESSING" || status === "SHIPPED" || status === "DELIVERED";
}

/**
 * F-199 fix: whether an admin can still record that an ORDER_REQUEST
 * order's payment has been received — and, from SHIPPED/DELIVERED, record
 * it without moving the order's status.
 *
 * An order-request has no online payment step: it is created straight
 * into PROCESSING (create-order.ts) and the money arrives later by UPI,
 * bank transfer or cash — for cash on delivery that is *after* the parcel
 * has shipped, even after it was delivered. Recording the payment must
 * therefore not depend on a status edge (PROCESSING -> PAID exists, but
 * SHIPPED and DELIVERED have no PAID edge and shouldn't: they are
 * fulfilment states, not payment ones). The single rule shared by the
 * server (updateOrderAdmin) and the admin order form so the two can't
 * drift apart:
 *
 *  - ORDER_REQUEST only (a RAZORPAY order's payment is captured online —
 *    verify route / webhook — so there is nothing for an admin to record);
 *  - payment not already recorded (`paidAt` is the one real fact — a
 *    second recording would just overwrite the first one's date);
 *  - PROCESSING, SHIPPED or DELIVERED (PENDING_PAYMENT/PAID are covered by
 *    the status transition itself; a cancelled/refunded/returned order
 *    has no money to record).
 */
export function canRecordOrderRequestPayment(
  paymentMethod: PaymentMethod,
  status: OrderStatus,
  paymentRecorded: boolean,
): boolean {
  return paymentMethod === "ORDER_REQUEST" && !paymentRecorded && isPaymentRecordableStatus(status);
}
