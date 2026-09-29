import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

/**
 * F-328: pure, unit-testable helpers for the printed/saved order receipt
 * (src/app/order/[number]/page.tsx). Kept separate from that Server
 * Component the same way src/lib/orders/timeline.ts is kept separate from
 * its presentational component, so the payment-status wording can be
 * asserted directly in a test without rendering anything.
 */

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  RAZORPAY: "Razorpay",
  ORDER_REQUEST: "Order Request (manual invoice)",
};

/**
 * A concise payment-status phrase for the receipt — deliberately distinct
 * from the order-status line already shown above it on the page, since
 * "Processing" (order status) and "paid" (payment status) aren't always
 * the same fact for an ORDER_REQUEST order (see getOrderTimeline's
 * PROCESSING case, src/lib/orders/timeline.ts). Never claims a payment
 * was captured unless the data actually says so — the same "don't invent
 * what isn't verifiable" rule that file documents for its CANCELLED case.
 */
export function getReceiptPaymentSummary(
  status: OrderStatus,
  paymentMethod: PaymentMethod,
  /** Whether this order ever actually captured a Razorpay payment
   * (`razorpayPaymentId !== null`) — irrelevant for ORDER_REQUEST. Same
   * flag getOrderTimeline takes for its CANCELLED case. */
  hasCapturedPayment: boolean,
  wasPaid = false,
): string {
  const method = PAYMENT_METHOD_LABELS[paymentMethod];
  switch (status) {
    case "PENDING_PAYMENT":
      return paymentMethod === "ORDER_REQUEST"
        ? `${method} · awaiting confirmation`
        : `${method} · awaiting payment`;
    case "PROCESSING":
      // An ORDER_REQUEST order can reach PROCESSING without our team ever
      // having confirmed payment yet (create-order.ts creates it directly
      // into PROCESSING) — same subtlety timeline.ts's PROCESSING case
      // documents.
      return paymentMethod === "ORDER_REQUEST" && !wasPaid ? `${method} · awaiting confirmation` : `${method} · paid`;
    case "PAID":
      return `${method} · paid`;
    case "SHIPPED":
    case "DELIVERED":
      return paymentMethod === "ORDER_REQUEST" && !wasPaid ? `${method} · payment not recorded` : `${method} · paid`;
    case "CANCELLED": {
      const neverPaid = paymentMethod === "RAZORPAY" && !hasCapturedPayment;
      return neverPaid ? `${method} · not charged` : `${method} · cancelled`;
    }
    case "REFUNDED":
      return `${method} · refunded`;
    case "RETURNED":
      return `${method} · returned`;
    default: {
      const exhaustiveCheck: never = status;
      return `${method} · ${String(exhaustiveCheck)}`;
    }
  }
}

/**
 * "Placed <date>" line for the receipt, explicitly in IST regardless of
 * the rendering server's own local timezone.
 */
export function formatReceiptDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
