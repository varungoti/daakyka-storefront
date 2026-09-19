import { db } from "@/lib/db";
import type { OrderStatus, PaymentMethod, Prisma } from "@/generated/prisma/client";

/**
 * Release-hardening item 2 (Medium parity gap — see
 * docs/audit-2026-09-19/storefront-ux.md's "Order tracking page" row):
 * customer-facing order history, scoped strictly to one customerId.
 *
 * Deliberately its own file rather than an addition to
 * src/lib/orders/admin-orders.ts — that module's queries are
 * permission-gated and shaped for staff (guest name extraction, CSV
 * export, cross-customer search); this one is intentionally narrower
 * (always `where: { customerId }`, no filters a customer shouldn't have)
 * so there's no risk of an admin-only capability leaking onto the
 * customer-facing route by accident. Mirrors get-order.ts's convention
 * of taking `customerId` as an already-resolved plain parameter instead
 * of calling getCustomerSession() itself, so it stays callable from
 * tests without a real Next.js request (see the harness note in
 * tests/integration/customer-auth.test.ts).
 */

const CUSTOMER_ORDER_LIST_INCLUDE = {
  _count: { select: { items: true } },
} satisfies Prisma.OrderInclude;

export interface CustomerOrderListItem {
  id: string;
  number: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  itemCount: number;
  total: number;
  currency: string;
  trackingNumber: string | null;
  courier: string | null;
  createdAt: Date;
}

export interface ListOrdersForCustomerResult {
  items: CustomerOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

export async function listOrdersForCustomer(
  customerId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<ListOrdersForCustomerResult> {
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize ?? DEFAULT_PAGE_SIZE), 1), MAX_PAGE_SIZE);
  const total = await db.order.count({ where: { customerId } });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(Math.trunc(options.page ?? 1), 1), totalPages);

  const rows = await db.order.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: CUSTOMER_ORDER_LIST_INCLUDE,
  });

  return {
    items: rows.map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      paymentMethod: row.paymentMethod,
      itemCount: row._count.items,
      total: Number(row.total),
      currency: row.currency,
      trackingNumber: row.trackingNumber,
      courier: row.courier,
      createdAt: row.createdAt,
    })),
    total,
    page,
    pageSize,
    totalPages,
  };
}
