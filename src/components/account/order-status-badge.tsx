import { cn } from "@/lib/utils";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

/**
 * Release-hardening item 2 — shared status pill for the customer order
 * list and detail pages. Distinct from the admin order table's styling
 * (src/components/admin/orders-table.tsx renders raw enum text for
 * staff); this one uses customer-facing copy, and special-cases an
 * unconfirmed ORDER_REQUEST order (see getOrderStatusLabel below) so it
 * never reads as a declined/failed payment (release brief, item 2).
 */
const STATUS_META: Record<OrderStatus, { label: string; className: string }> = {
  PENDING_PAYMENT: { label: "Awaiting Payment", className: "bg-amber-100 text-amber-800" },
  PAID: { label: "Paid", className: "bg-trust/15 text-trust" },
  PROCESSING: { label: "Processing", className: "bg-blue-100 text-blue-800" },
  SHIPPED: { label: "Shipped", className: "bg-purple-100 text-purple-800" },
  DELIVERED: { label: "Delivered", className: "bg-green-100 text-green-800" },
  CANCELLED: { label: "Cancelled", className: "bg-red-100 text-red-700" },
  REFUNDED: { label: "Refunded", className: "bg-gray-200 text-gray-700" },
  // F-199 fix: a shipped/delivered order can now be returned — see
  // status-transitions.ts.
  RETURNED: { label: "Returned", className: "bg-orange-100 text-orange-700" },
};

/**
 * F-140 fix: create-order.ts puts an ORDER_REQUEST order straight into
 * PROCESSING (it has no online payment step to gate on), never
 * PENDING_PAYMENT — so the original "PENDING_PAYMENT + ORDER_REQUEST ->
 * Order Received" special case never actually fired for a real order. The
 * badge read the raw "PROCESSING" label while the timeline right below it
 * (getOrderTimeline, src/lib/orders/timeline.ts) already said "Awaiting
 * confirmation" for the exact same order. Both PENDING_PAYMENT and
 * PROCESSING are "we haven't confirmed this order-request yet" for an
 * ORDER_REQUEST order, so both read as "Order Received" here — pulled out
 * as its own function so it's directly unit-testable without rendering
 * anything (order-status-badge.test.ts).
 *
 * F-199 fix: once an admin has recorded the order-request's payment
 * (`paid`, from `Order.paidAt`) it *is* confirmed — the timeline then
 * shows "Order confirmed", so an order that went PAID -> back to
 * PROCESSING reads plain "Processing" here too rather than "Order
 * Received" again.
 */
export function getOrderStatusLabel(status: OrderStatus, paymentMethod: PaymentMethod, paid = false): string {
  if (paymentMethod === "ORDER_REQUEST" && !paid && (status === "PENDING_PAYMENT" || status === "PROCESSING")) {
    return "Order Received";
  }
  return STATUS_META[status].label;
}

export function OrderStatusBadge({
  status,
  paymentMethod,
  paid = false,
}: {
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  /** Whether `Order.paidAt` is set — see getOrderStatusLabel. */
  paid?: boolean;
}) {
  const meta = STATUS_META[status];
  const label = getOrderStatusLabel(status, paymentMethod, paid);

  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide",
        meta.className,
      )}
    >
      {label}
    </span>
  );
}
