import { cn } from "@/lib/utils";
import type { OrderStatus, PaymentMethod } from "@/generated/prisma/client";

/**
 * Release-hardening item 2 — shared status pill for the customer order
 * list and detail pages. Distinct from the admin order table's styling
 * (src/components/admin/orders-table.tsx renders raw enum text for
 * staff); this one uses customer-facing copy, and special-cases
 * PENDING_PAYMENT + ORDER_REQUEST so an unpaid manual-invoice order never
 * reads as a declined/failed payment (release brief, item 2).
 */
const STATUS_META: Record<OrderStatus, { label: string; className: string }> = {
  PENDING_PAYMENT: { label: "Awaiting Payment", className: "bg-amber-100 text-amber-800" },
  PAID: { label: "Paid", className: "bg-trust/15 text-trust" },
  PROCESSING: { label: "Processing", className: "bg-blue-100 text-blue-800" },
  SHIPPED: { label: "Shipped", className: "bg-purple-100 text-purple-800" },
  DELIVERED: { label: "Delivered", className: "bg-green-100 text-green-800" },
  CANCELLED: { label: "Cancelled", className: "bg-red-100 text-red-700" },
  REFUNDED: { label: "Refunded", className: "bg-gray-200 text-gray-700" },
};

export function OrderStatusBadge({ status, paymentMethod }: { status: OrderStatus; paymentMethod: PaymentMethod }) {
  const meta = STATUS_META[status];
  const label = status === "PENDING_PAYMENT" && paymentMethod === "ORDER_REQUEST" ? "Order Received" : meta.label;

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
