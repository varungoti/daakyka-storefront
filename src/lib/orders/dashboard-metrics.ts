import type { OrderStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { startOfTodayIST } from "@/lib/format/datetime";

/**
 * F-059: order statuses that count as real, confirmed commerce for admin
 * "today" metrics. The dashboard's "Orders Today" card used to count and
 * sum every order created today with no status filter at all, so a
 * CANCELLED order (or an abandoned Razorpay checkout still sitting in
 * PENDING_PAYMENT — see src/lib/orders/create-order.ts) inflated both the
 * order count and "revenue placed today" headline.
 *
 * REFUNDED and RETURNED are excluded so a refund doesn't inflate gross
 * revenue. ORDER_REQUEST (manual-invoice) orders start life in
 * PROCESSING before any money is collected — see create-order.ts — and
 * are intentionally still counted here, matching
 * src/lib/customers/admin-customers.ts's SPENT_STATUSES, which uses the
 * same commerce definition for a customer's lifetime spend.
 */
export const CONFIRMED_ORDER_STATUSES: readonly OrderStatus[] = [
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
];

export interface OrdersTodayStats {
  /** Confirmed orders (see CONFIRMED_ORDER_STATUSES) placed since IST midnight. */
  count: number;
  /** Sum of `total` for those confirmed orders. */
  revenue: number;
  /** Orders still awaiting payment, placed since IST midnight — shown separately, never as revenue. */
  pendingPaymentCount: number;
}

/**
 * "Orders Today" for the admin dashboard. Confirmed-only count/revenue,
 * plus a separate "awaiting payment" count so an abandoned checkout is
 * visible without being counted as revenue. The boundary is IST midnight
 * (`startOfTodayIST`), not the process's own timezone — see
 * src/lib/format/datetime.ts (F-060).
 *
 * `now` is injectable so tests can pin the clock instead of depending on
 * the real one.
 */
export async function getOrdersTodayStats(now: Date = new Date()): Promise<OrdersTodayStats> {
  const startOfToday = startOfTodayIST(now);

  const [confirmed, pendingPaymentCount] = await Promise.all([
    db.order.aggregate({
      where: {
        createdAt: { gte: startOfToday },
        status: { in: [...CONFIRMED_ORDER_STATUSES] },
      },
      _count: { _all: true },
      _sum: { total: true },
    }),
    db.order.count({
      where: { createdAt: { gte: startOfToday }, status: "PENDING_PAYMENT" },
    }),
  ]);

  return {
    count: confirmed._count._all,
    revenue: Number(confirmed._sum.total ?? 0),
    pendingPaymentCount,
  };
}
