import { stringifyCsv } from "@/lib/catalog/csv";

/**
 * Phase D4: admin order CSV export. Row formatting is a pure function
 * (no Prisma import) so it's unit-testable without a database — the
 * DB-backed listing lives in src/lib/orders/admin-orders.ts, which calls
 * `buildOrdersCsv` (or, for the actual HTTP export route, the
 * cursor-batched `streamOrdersCsv`) after fetching the filtered rows.
 *
 * F-204 fix (release-hardening admin-order-list-detail-ux): the export
 * used to be 14 columns with no customer name, no shipping address and no
 * line items — not enough to drive a courier booking or a GST return
 * without opening every order individually. Extended below, plus:
 *  - formula injection: a cell starting with = + - @ (or a tab/CR, which
 *    some spreadsheet apps also treat as a formula lead-in) gets an
 *    apostrophe prefix, forcing it to render as text. Deliberately a
 *    *local* helper (`csvSafeCell`), not a change to the shared
 *    `csvEscape`/`stringifyCsv` in src/lib/catalog/csv.ts — that module's
 *    CSV round-trips through `parseCsv` on product re-import, so an
 *    unconditional apostrophe prefix there would literally corrupt any
 *    description/SKU/tag that happens to start with one of those
 *    characters (e.g. a bulleted description starting with "-").
 *  - timestamps: rendered in IST, matching the admin's own date-filter
 *    boundaries (see date-range.ts) instead of a bare UTC ISO string.
 */
export const ORDER_EXPORT_COLUMNS = [
  "order_number",
  "email",
  "phone",
  "customer_name",
  "status",
  "payment_method",
  "item_count",
  "items",
  "subtotal",
  "shipping",
  "discount",
  "discount_code",
  "total",
  "currency",
  "tracking_number",
  "courier",
  "ship_name",
  "ship_address_line1",
  "ship_address_line2",
  "ship_city",
  "ship_state",
  "ship_pincode",
  "ship_country",
  "created_at_ist",
] as const;

export interface OrderCsvRow {
  number: string;
  email: string;
  phone: string | null;
  customerName: string | null;
  status: string;
  paymentMethod: string;
  itemCount: number;
  /** e.g. "AUDIT-SKU-1 x2; AUDIT-SKU-2 x1" — see admin-orders.ts's
   * mapOrderRowToCsvRow for how this is built. */
  itemsSummary: string;
  subtotal: number;
  shipping: number;
  discount: number;
  discountCode: string | null;
  total: number;
  currency: string;
  trackingNumber: string | null;
  courier: string | null;
  shipName: string | null;
  shipAddressLine1: string | null;
  shipAddressLine2: string | null;
  shipCity: string | null;
  shipState: string | null;
  shipPincode: string | null;
  shipCountry: string | null;
  createdAt: Date;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "2026-09-25 14:17:11+05:30" — IST has a single fixed UTC+5:30 offset
 * (no DST), so a flat offset add is exact year-round. Kept close to ISO
 * (not `toLocaleString`) so the column stays sortable and re-parseable. */
function formatCreatedAtIst(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  return `${ist.toISOString().slice(0, 19).replace("T", " ")}+05:30`;
}

/** Prefixes a cell with `'` when it starts with a character a spreadsheet
 * app would otherwise read as a formula lead-in (=, +, -, @) or that some
 * apps mis-treat as a control character (tab, CR) — see this file's doc
 * comment for why this is local to the order export rather than a change
 * to the shared CSV escaper. Only ever applied to free-text cells; numeric
 * columns (subtotal, total, ...) are passed through `stringifyCsv` as
 * numbers, never as strings, so they're untouched. */
function csvSafeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function formatOrderRowForCsv(order: OrderCsvRow): (string | number)[] {
  return [
    csvSafeCell(order.number),
    csvSafeCell(order.email),
    csvSafeCell(order.phone ?? ""),
    csvSafeCell(order.customerName ?? ""),
    order.status,
    order.paymentMethod,
    order.itemCount,
    csvSafeCell(order.itemsSummary),
    order.subtotal,
    order.shipping,
    order.discount,
    csvSafeCell(order.discountCode ?? ""),
    order.total,
    order.currency,
    csvSafeCell(order.trackingNumber ?? ""),
    csvSafeCell(order.courier ?? ""),
    csvSafeCell(order.shipName ?? ""),
    csvSafeCell(order.shipAddressLine1 ?? ""),
    csvSafeCell(order.shipAddressLine2 ?? ""),
    csvSafeCell(order.shipCity ?? ""),
    csvSafeCell(order.shipState ?? ""),
    csvSafeCell(order.shipPincode ?? ""),
    csvSafeCell(order.shipCountry ?? ""),
    formatCreatedAtIst(order.createdAt),
  ];
}

/** The data rows only (no header), already `stringifyCsv`-escaped — used
 * by `streamOrdersCsv` to emit one batch at a time. Returns "" for an
 * empty batch (never a bare trailing newline). */
export function formatOrderCsvRows(orders: OrderCsvRow[]): string {
  if (orders.length === 0) return "";
  return stringifyCsv(orders.map(formatOrderRowForCsv));
}

export function buildOrdersCsv(orders: OrderCsvRow[]): string {
  const rows: (string | number)[][] = [[...ORDER_EXPORT_COLUMNS]];
  for (const order of orders) {
    rows.push(formatOrderRowForCsv(order));
  }
  return stringifyCsv(rows);
}
