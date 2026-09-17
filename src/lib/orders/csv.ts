import { stringifyCsv } from "@/lib/catalog/csv";

/**
 * Phase D4: admin order CSV export. Row formatting is a pure function
 * (no Prisma import) so it's unit-testable without a database — the
 * DB-backed listing lives in src/lib/orders/admin-orders.ts, which calls
 * `buildOrdersCsv` after fetching the filtered rows.
 */
export const ORDER_EXPORT_COLUMNS = [
  "order_number",
  "email",
  "phone",
  "status",
  "payment_method",
  "item_count",
  "subtotal",
  "shipping",
  "discount",
  "total",
  "currency",
  "tracking_number",
  "courier",
  "created_at",
] as const;

export interface OrderCsvRow {
  number: string;
  email: string;
  phone: string | null;
  status: string;
  paymentMethod: string;
  itemCount: number;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  currency: string;
  trackingNumber: string | null;
  courier: string | null;
  createdAt: Date;
}

export function formatOrderRowForCsv(order: OrderCsvRow): (string | number)[] {
  return [
    order.number,
    order.email,
    order.phone ?? "",
    order.status,
    order.paymentMethod,
    order.itemCount,
    order.subtotal,
    order.shipping,
    order.discount,
    order.total,
    order.currency,
    order.trackingNumber ?? "",
    order.courier ?? "",
    order.createdAt.toISOString(),
  ];
}

export function buildOrdersCsv(orders: OrderCsvRow[]): string {
  const rows: (string | number)[][] = [[...ORDER_EXPORT_COLUMNS]];
  for (const order of orders) {
    rows.push(formatOrderRowForCsv(order));
  }
  return stringifyCsv(rows);
}
