import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { Order, OrderStatus, PaymentMethod } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";
import { assertValidOrderStatusTransition, orderStatusTimestampField } from "@/lib/orders/status-transitions";
import { buildOrdersCsv, formatOrderCsvRows, ORDER_EXPORT_COLUMNS, type OrderCsvRow } from "@/lib/orders/csv";
import { applyPaidSideEffects, releaseOrderInventory } from "@/lib/orders/payment-transitions";
import { revalidateProductStockForVariants } from "@/lib/products";
import { notifyOrderStatusChange } from "@/lib/orders/notify";

/**
 * Phase D4: admin order listing, detail, status-transition and CSV-export
 * service layer, built on top of D3's `Order`/`OrderItem` models.
 *
 * F-224 fix (release-hardening schema-foundation): listing used to load
 * every row matching the filters and sort/paginate in JS — fine at launch
 * volume, but it means every admin page view transfers the whole table,
 * which doesn't scale and is worse on the owner's phone over a
 * cross-region connection. `listOrdersForAdmin` now does the count, sort
 * and page slice in the database (skip/take + a stable id tie-breaker —
 * see `buildOrderOrderBy`). `exportOrdersCsv` deliberately keeps fetching
 * every matching row — a CSV export has to, by design — but sorts in the
 * query instead of in JS.
 */

/**
 * Release-hardening F-01 / plan item 1.4: a guest order's real name lives
 * only in `Order.shippingAddress` (JSON, shaped like `ShippingAddressInput`
 * — see src/lib/validation/schemas.ts) since guest checkout never creates a
 * `Customer` row (see create-order.ts). Every admin-facing read of an order
 * exposes it as `guestName` below, alongside `customerName` (which stays
 * strictly "the name of the linked Customer, if any" so callers can still
 * tell a real account from a guest). Written defensively against
 * malformed/legacy JSON — never throws, just falls back to `null`.
 */
export function extractGuestName(shippingAddress: unknown): string | null {
  if (!shippingAddress || typeof shippingAddress !== "object") return null;
  const name = (shippingAddress as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * F-204 fix: the orders CSV export used to leave the shipping address out
 * entirely, even though it's the one piece of data a courier booking or a
 * GST return actually needs. Reads the same JSON `extractGuestName` reads,
 * just as defensively — never throws on malformed/legacy data, only ever
 * returns `null` fields.
 */
function extractShippingAddressFields(shippingAddress: unknown): {
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  country: string | null;
} {
  const empty = { name: null, line1: null, line2: null, city: null, state: null, pincode: null, country: null };
  if (!shippingAddress || typeof shippingAddress !== "object") return empty;
  const addr = shippingAddress as Record<string, unknown>;
  const str = (key: string): string | null => (typeof addr[key] === "string" && addr[key].trim() ? (addr[key] as string).trim() : null);
  return {
    name: str("name"),
    line1: str("line1"),
    line2: str("line2"),
    city: str("city"),
    state: str("state"),
    pincode: str("pincode"),
    country: str("country"),
  };
}

export const orderStatusValues = [
  "PENDING_PAYMENT",
  "PAID",
  "PROCESSING",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const satisfies readonly OrderStatus[];

export const paymentMethodValues = ["RAZORPAY", "ORDER_REQUEST"] as const satisfies readonly PaymentMethod[];

export const orderListSortValues = ["createdAt-desc", "createdAt-asc", "total-desc", "total-asc"] as const;
export type OrderListSort = (typeof orderListSortValues)[number];

export class OrderNotFoundError extends Error {
  constructor(id: string) {
    super(`Order ${id} not found`);
    this.name = "OrderNotFoundError";
  }
}

export class MissingTrackingInfoError extends Error {
  constructor() {
    super("Tracking number and courier are required when marking an order as shipped");
    this.name = "MissingTrackingInfoError";
  }
}

export class OrderUpdateConflictError extends Error {
  constructor(id: string) {
    super(`Order ${id} was updated concurrently — please refresh and try again`);
    this.name = "OrderUpdateConflictError";
  }
}

/**
 * F-282 fix (release-hardening order-lifecycle-payment-integrity): a paid
 * Razorpay order's status has never had anything to do with the money —
 * nothing in this codebase calls Razorpay's refund API — so setting one to
 * CANCELLED or REFUNDED used to silently move zero rupees while the
 * customer-facing timeline (src/lib/orders/timeline.ts) told the shopper
 * "This order was refunded." Rather than either fully blocking the
 * transition (which would leave an admin with no way to close an order
 * whose refund.processed webhook was never wired up in the Razorpay
 * dashboard) or silently allowing it, updateOrderAdmin now requires the
 * caller to explicitly acknowledge that no money moves automatically —
 * see orderUpdateSchema's `acknowledgeExternalRefund`.
 */
export class RefundAcknowledgementRequiredError extends Error {
  constructor() {
    super(
      "This only changes the order status — it does NOT refund the customer. Refund the payment in Razorpay first, then confirm.",
    );
    this.name = "RefundAcknowledgementRequiredError";
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface ListOrdersForAdminOptions {
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sort?: OrderListSort;
  page?: number;
  pageSize?: number;
}

export interface AdminOrderListItem {
  id: string;
  number: string;
  email: string;
  phone: string | null;
  customerName: string | null;
  /** Real name the shopper typed at checkout (from shippingAddress), only
   * ever populated for a guest order (no linked Customer) — see
   * extractGuestName's doc comment. */
  guestName: string | null;
  itemCount: number;
  subtotal: number;
  shipping: number;
  discount: number;
  discountCode: string | null;
  total: number;
  currency: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  trackingNumber: string | null;
  courier: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListOrdersForAdminResult {
  items: AdminOrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * F-200 fix: pulls out the digits of a search term so "9876543212",
 * "+91 98765 43212" and "98765-43212" all match a phone stored as plain
 * digits. Strips a leading country/trunk prefix only when there are more
 * than 10 digits left afterwards, so a genuine 10-digit number is never
 * mistakenly shortened. Returns null when there aren't enough digits to
 * search on (avoids a `phone contains ""` clause matching every order).
 */
function normalizePhoneSearchTerm(term: string): string | null {
  const digits = term.replace(/\D/g, "");
  if (digits.length < 4) return null;
  if (digits.length > 10 && (digits.startsWith("91") || digits.startsWith("0"))) {
    return digits.slice(digits.length - 10);
  }
  return digits;
}

/**
 * F-200 fix: `buildOrderWhere` is async because a guest order's real name
 * lives only in `Order.shippingAddress` (JSON — see `extractGuestName`'s
 * doc comment), and Postgres's `Json` filters have no case-insensitive
 * `contains` on this Prisma version. Rather than loading every order into
 * JS to filter there (defeating the whole point of F-224's DB-side
 * pagination), this runs one small parameterized raw query to prefilter by
 * id, then folds those ids into the same `OR` as every other search
 * clause — the enclosing `where` still ANDs in status/paymentMethod/date
 * normally.
 */
async function buildOrderWhere(options: {
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
}): Promise<Prisma.OrderWhereInput> {
  const where: Prisma.OrderWhereInput = {};
  if (options.status) where.status = options.status;
  if (options.paymentMethod) where.paymentMethod = options.paymentMethod;
  if (options.search && options.search.trim()) {
    const term = options.search.trim();
    const or: Prisma.OrderWhereInput[] = [
      { number: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      // F-200 fix: a registered customer's name, via the relation.
      { customer: { is: { name: { contains: term, mode: "insensitive" } } } },
    ];
    const phoneDigits = normalizePhoneSearchTerm(term);
    if (phoneDigits) {
      or.push({ phone: { contains: phoneDigits } });
    }
    // F-200 fix: a guest order's name (no linked Customer) — parameterized
    // raw query, never string concatenation.
    const guestNameMatches = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Order" WHERE "shippingAddress"->>'name' ILIKE ${`%${term}%`}
    `;
    if (guestNameMatches.length > 0) {
      or.push({ id: { in: guestNameMatches.map((row) => row.id) } });
    }
    where.OR = or;
  }
  if (options.dateFrom || options.dateTo) {
    where.createdAt = {
      ...(options.dateFrom ? { gte: options.dateFrom } : {}),
      // F-068 fix: `dateTo` is now the *exclusive* upper bound (the next
      // IST midnight after the selected "To" day — see
      // src/lib/format/datetime.ts's parseIstDateOnlyExclusiveEnd, which
      // both admin routes call before this ever runs). `lt`, not `lte`,
      // so the whole "To" day is included instead of being cut off at its
      // very first instant.
      ...(options.dateTo ? { lt: options.dateTo } : {}),
    };
  }
  return where;
}

/**
 * F-224 fix: maps the public sort key to a DB `orderBy`, always with `id`
 * as a second key. Without it, rows that tie on the primary key (two
 * orders created in the same millisecond, or the very common case of two
 * orders both totalling the flat-rate-shipping minimum) can repeat or be
 * skipped across a skip/take page boundary — `id` (cuid, monotonically
 * increasing-ish and always unique) makes every page a stable, disjoint
 * slice.
 */
function buildOrderOrderBy(sort: OrderListSort): Prisma.OrderOrderByWithRelationInput[] {
  switch (sort) {
    case "createdAt-asc":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "total-desc":
      return [{ total: "desc" }, { id: "desc" }];
    case "total-asc":
      return [{ total: "asc" }, { id: "asc" }];
    case "createdAt-desc":
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

const ORDER_LIST_INCLUDE = {
  customer: { select: { name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.OrderInclude;

type OrderListRow = Prisma.OrderGetPayload<{ include: typeof ORDER_LIST_INCLUDE }>;

function mapOrderListRow(row: OrderListRow): AdminOrderListItem {
  return {
    id: row.id,
    number: row.number,
    email: row.email,
    phone: row.phone,
    customerName: row.customer?.name ?? null,
    guestName: row.customer ? null : extractGuestName(row.shippingAddress),
    itemCount: row._count.items,
    subtotal: Number(row.subtotal),
    shipping: Number(row.shipping),
    discount: Number(row.discount),
    discountCode: row.discountCode,
    total: Number(row.total),
    currency: row.currency,
    status: row.status,
    paymentMethod: row.paymentMethod,
    trackingNumber: row.trackingNumber,
    courier: row.courier,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listOrdersForAdmin(
  options: ListOrdersForAdminOptions = {},
): Promise<ListOrdersForAdminResult> {
  const where = await buildOrderWhere(options);
  const sort = options.sort ?? "createdAt-desc";
  const orderBy = buildOrderOrderBy(sort);

  const total = await db.order.count({ where });
  const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), totalPages);
  const skip = (page - 1) * pageSize;

  const rows = await db.order.findMany({
    where,
    orderBy,
    skip,
    take: pageSize,
    include: ORDER_LIST_INCLUDE,
  });
  const items = rows.map(mapOrderListRow);

  return { items, total, page, pageSize, totalPages };
}

// F-204 fix: the export used to select only 14 flat columns. Now also
// pulls the shipping address JSON, the linked customer's name (for a
// guest order, extractGuestName reads the same shippingAddress below) and
// each line item's sku/name/qty, so the CSV can drive a courier booking or
// a GST return without opening every order individually.
const ORDER_CSV_SELECT = {
  id: true,
  number: true,
  email: true,
  phone: true,
  status: true,
  paymentMethod: true,
  subtotal: true,
  shipping: true,
  discount: true,
  discountCode: true,
  total: true,
  currency: true,
  trackingNumber: true,
  courier: true,
  createdAt: true,
  shippingAddress: true,
  customer: { select: { name: true } },
  items: { select: { sku: true, productName: true, quantity: true } },
} satisfies Prisma.OrderSelect;

type OrderCsvSourceRow = Prisma.OrderGetPayload<{ select: typeof ORDER_CSV_SELECT }>;

function mapOrderRowToCsvRow(row: OrderCsvSourceRow): OrderCsvRow {
  const address = extractShippingAddressFields(row.shippingAddress);
  return {
    number: row.number,
    email: row.email,
    phone: row.phone,
    customerName: row.customer?.name ?? extractGuestName(row.shippingAddress),
    status: row.status,
    paymentMethod: row.paymentMethod,
    itemCount: row.items.length,
    // F-204 fix: a compact per-order line-item summary rather than
    // exploding one CSV row per item — keeps the export at one row per
    // order (what the admin's filters/sort already operate on) while
    // still surfacing SKU/qty for courier and accounting use.
    itemsSummary: row.items.map((item) => `${item.sku ?? item.productName} x${item.quantity}`).join("; "),
    subtotal: Number(row.subtotal),
    shipping: Number(row.shipping),
    discount: Number(row.discount),
    discountCode: row.discountCode,
    total: Number(row.total),
    currency: row.currency,
    trackingNumber: row.trackingNumber,
    courier: row.courier,
    shipName: address.name,
    shipAddressLine1: address.line1,
    shipAddressLine2: address.line2,
    shipCity: address.city,
    shipState: address.state,
    shipPincode: address.pincode,
    shipCountry: address.country,
    createdAt: row.createdAt,
  };
}

export async function exportOrdersCsv(
  options: Omit<ListOrdersForAdminOptions, "sort" | "page" | "pageSize"> = {},
): Promise<string> {
  const where = await buildOrderWhere(options);
  // Deliberately unbounded (no skip/take) — a CSV export has to return
  // every matching row by design. The DB does the sort (createdAt desc,
  // id as a tie-breaker) instead of an in-memory sort. Kept for callers
  // (unit/integration tests, and anywhere a plain string is fine) that
  // don't need the streamed response — see `streamOrdersCsv` below, which
  // the actual export route uses so a large export never has to hold its
  // whole body in memory at once (F-342).
  const rows = await db.order.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: ORDER_CSV_SELECT,
  });

  return buildOrdersCsv(rows.map(mapOrderRowToCsvRow));
}

/**
 * F-342 fix: the export route used to call `exportOrdersCsv` above and
 * return the whole CSV as one `Response` body — fine at launch volume, but
 * it means building a multi-megabyte string (and the equivalent Prisma
 * result set) in memory for one request, and Vercel functions cap a
 * response body at 4.5MB regardless. This streams the same rows in
 * `batchSize`-sized pages, cursor-paginated on `id` (never `skip`, which
 * would re-scan every prior page on every batch), so memory stays
 * bounded by one batch instead of the whole export. `batchSize` is a
 * parameter (not just the default) so tests can force multiple batches
 * without needing thousands of fixture rows.
 */
export function streamOrdersCsv(
  options: Omit<ListOrdersForAdminOptions, "sort" | "page" | "pageSize"> = {},
  batchSize = 1000,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const where = await buildOrderWhere(options);
        // UTF-8 BOM first, so Excel (which the export exists for) opens
        // the file as UTF-8 instead of guessing a legacy codepage — added
        // here, not in buildOrdersCsv, so the pure string-builder used by
        // unit tests stays BOM-free and easy to assert on.
        // Built via fromCharCode(0xfeff), not a quoted escape sequence for
        // that code point — the latter is indistinguishable, once written,
        // from a literal (invisible) BOM character pasted straight into
        // the source file: functionally identical, but unreviewable.
        controller.enqueue(encoder.encode(String.fromCharCode(0xfeff)));
        controller.enqueue(encoder.encode(`${ORDER_EXPORT_COLUMNS.join(",")}\n`));

        let cursor: string | undefined;
        for (;;) {
          const rows = await db.order.findMany({
            where,
            orderBy: [{ id: "asc" }],
            take: batchSize,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: ORDER_CSV_SELECT,
          });
          if (rows.length === 0) break;

          const chunk = formatOrderCsvRows(rows.map(mapOrderRowToCsvRow));
          if (chunk) controller.enqueue(encoder.encode(`${chunk}\n`));

          if (rows.length < batchSize) break;
          cursor = rows[rows.length - 1].id;
        }
        controller.close();
      } catch (err) {
        // A mid-stream failure can't turn into an HTTP error status (the
        // headers already went out) — erroring the stream at least
        // truncates the download instead of silently serving a
        // truncated-but-200 file, and surfaces in server logs.
        controller.error(err);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

const ORDER_DETAIL_INCLUDE = {
  customer: { select: { id: true, name: true, email: true } },
  items: {
    orderBy: { createdAt: "asc" },
    // release-hardening F-195: OrderItem itself has no HSN snapshot (that
    // would need a schema migration this package can't make — see
    // src/app/admin/(panel)/orders/[id]/invoice/page.tsx's own comment),
    // so the invoice reads the *current* product's HSN through the
    // variant it was ordered from. A best-effort join, not a historical
    // snapshot: if the product's HSN is edited after this order shipped,
    // an older invoice reprint shows the new code. Acceptable for a first
    // pass — flagged as a follow-up once OrderItem gets a real tax
    // snapshot.
    include: { variant: { include: { product: { select: { hsnCode: true } } } } },
  },
} satisfies Prisma.OrderInclude;

export type OrderDetailRow = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;

export interface AdminOrderItemView {
  id: string;
  productName: string;
  variantLabel: string | null;
  sku: string | null;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
  hsnCode: string | null;
}

export interface AdminOrderDetail {
  id: string;
  number: string;
  customerId: string | null;
  customerName: string | null;
  /** Same fallback as AdminOrderListItem.guestName — see extractGuestName. */
  guestName: string | null;
  email: string;
  phone: string | null;
  shippingAddress: unknown;
  subtotal: number;
  shipping: number;
  discount: number;
  discountCode: string | null;
  total: number;
  currency: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  razorpayPaymentUrl: string | null;
  trackingNumber: string | null;
  courier: string | null;
  notes: string | null;
  adminNotes: string | null;
  items: AdminOrderItemView[];
  createdAt: Date;
  updatedAt: Date;
  // release-hardening F-195: the GST invoice serial, assigned lazily (see
  // src/lib/orders/invoice-number.ts) — null for an order that hasn't
  // reached an invoice-eligible status yet.
  invoiceNumber: string | null;
}

export function serializeOrderDetail(row: OrderDetailRow): AdminOrderDetail {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    guestName: row.customer ? null : extractGuestName(row.shippingAddress),
    email: row.email,
    phone: row.phone,
    shippingAddress: row.shippingAddress,
    subtotal: Number(row.subtotal),
    shipping: Number(row.shipping),
    discount: Number(row.discount),
    discountCode: row.discountCode,
    total: Number(row.total),
    currency: row.currency,
    status: row.status,
    paymentMethod: row.paymentMethod,
    razorpayOrderId: row.razorpayOrderId,
    razorpayPaymentId: row.razorpayPaymentId,
    // Convenience link only — never fetched from Razorpay's API.
    razorpayPaymentUrl: row.razorpayPaymentId
      ? `https://dashboard.razorpay.com/app/payments/${row.razorpayPaymentId}`
      : null,
    trackingNumber: row.trackingNumber,
    courier: row.courier,
    notes: row.notes,
    adminNotes: row.adminNotes,
    items: row.items.map((item) => ({
      id: item.id,
      productName: item.productName,
      variantLabel: item.variantLabel,
      sku: item.sku,
      unitPrice: Number(item.unitPrice),
      quantity: item.quantity,
      imageUrl: item.imageUrl,
      hsnCode: item.variant?.product.hsnCode ?? null,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    invoiceNumber: row.invoiceNumber,
  };
}

export async function getOrderForAdmin(id: string): Promise<AdminOrderDetail> {
  const row = await db.order.findUnique({ where: { id }, include: ORDER_DETAIL_INCLUDE });
  if (!row) throw new OrderNotFoundError(id);
  return serializeOrderDetail(row);
}

// ---------------------------------------------------------------------------
// History (F-205)
// ---------------------------------------------------------------------------

export interface OrderHistoryEntry {
  id: string;
  action: string;
  createdAt: Date;
  actorName: string | null;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus | null;
  trackingNumber: string | null;
  courier: string | null;
  adminNotesUpdated: boolean;
  manualPaidTransition: boolean;
  restockedUnits: number | null;
}

/**
 * F-205 fix: the order detail page showed no history at all, even though
 * every status change, tracking update and note edit is already recorded
 * in AuditLog (see updateOrderAdmin's `logAuditEvent` call below). This
 * reads that same trail back out for one order's timeline.
 *
 * `AuditLog.metadata` is a free-text JSON-encoded column (see
 * src/lib/auth/audit.ts's `logAuditEvent`), not a typed relation — parsed
 * defensively here, exactly like `extractGuestName` treats
 * `shippingAddress`: malformed or unexpected metadata renders the row with
 * no details rather than failing the whole timeline.
 */
export async function getOrderHistory(orderId: string): Promise<OrderHistoryEntry[]> {
  const rows = await db.auditLog.findMany({
    where: { entity: "order", entityId: orderId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true } } },
  });

  const asOrderStatus = (value: unknown): OrderStatus | null =>
    typeof value === "string" && (orderStatusValues as readonly string[]).includes(value) ? (value as OrderStatus) : null;

  return rows.map((row) => {
    let metadata: Record<string, unknown> = {};
    if (row.metadata) {
      try {
        const parsed: unknown = JSON.parse(row.metadata);
        if (parsed && typeof parsed === "object") metadata = parsed as Record<string, unknown>;
      } catch {
        // Malformed/legacy metadata — never block the timeline over it.
      }
    }
    return {
      id: row.id,
      action: row.action,
      createdAt: row.createdAt,
      actorName: row.user?.name ?? row.actorEmail ?? null,
      fromStatus: asOrderStatus(metadata.fromStatus),
      toStatus: asOrderStatus(metadata.toStatus),
      trackingNumber: typeof metadata.trackingNumber === "string" ? metadata.trackingNumber : null,
      courier: typeof metadata.courier === "string" ? metadata.courier : null,
      adminNotesUpdated: metadata.adminNotesUpdated === true,
      manualPaidTransition: metadata.manualPaidTransition === true,
      restockedUnits: typeof metadata.restockedUnits === "number" ? metadata.restockedUnits : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Update (status transition + tracking + admin notes)
// ---------------------------------------------------------------------------

export const orderUpdateSchema = z
  .object({
    status: z.enum(orderStatusValues).optional(),
    trackingNumber: z.string().trim().min(1).max(100).optional(),
    courier: z.string().trim().min(1).max(100).optional(),
    adminNotes: z.string().trim().max(5000).nullable().optional(),
    // F-282 fix: required (true) whenever this update moves a paid
    // RAZORPAY order to CANCELLED/REFUNDED — see
    // RefundAcknowledgementRequiredError's doc comment.
    acknowledgeExternalRefund: z.boolean().optional(),
    // F-339 fix: the `updatedAt` the caller's page/form was loaded with.
    // When present, updateOrderAdmin rejects the whole update with
    // OrderUpdateConflictError if the order has changed since — e.g. a
    // colleague saved a note a moment ago from another tab — instead of
    // silently overwriting whatever that concurrent edit touched.
    // Optional so callers that don't track it (or don't care) are
    // unaffected.
    updatedAt: z.coerce.date().optional(),
  })
  .refine((data) => data.status !== undefined || data.trackingNumber !== undefined || data.courier !== undefined || data.adminNotes !== undefined, {
    message: "At least one field (status, trackingNumber, courier, adminNotes) is required",
  });

export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;

export async function updateOrderAdmin(id: string, input: OrderUpdateInput, userId: string): Promise<Order> {
  const existing = await db.order.findUnique({
    where: { id },
    include: { items: true, appliedDiscount: true },
  });
  if (!existing) throw new OrderNotFoundError(id);

  // F-339 fix: a caller that tracked the `updatedAt` its page/form was
  // loaded with is telling us "reject this if the order has changed since
  // I last read it" — checked up front, before any validation below, so a
  // stale save never even gets to overwrite adminNotes/tracking/etc. with
  // whatever this caller last saw.
  if (input.updatedAt !== undefined && input.updatedAt.getTime() !== existing.updatedAt.getTime()) {
    throw new OrderUpdateConflictError(id);
  }

  const data: Prisma.OrderUpdateInput = {};
  // Finding B (release-hardening) / F-036 fix: an ORDER_REQUEST order
  // decrements stock immediately at creation (see createOrderFromCart's
  // docstring) because it has no payment step to gate on; a RAZORPAY
  // order decrements it once at its PAID transition (verify/webhook, or
  // the manual PENDING_PAYMENT -> PAID case below) and keeps it committed
  // through PROCESSING. Either way, once stock has actually been taken
  // from inventory, cancelling or refunding the order before it ships
  // must give it back — `stockCommitted` below is true for exactly the
  // states that implies for each payment method.
  // Release-hardening F7 / F-036 fix: same reasoning as stock — an
  // ORDER_REQUEST order's discount redemption is committed at creation, a
  // RAZORPAY order's at PAID — `releaseOrderInventory` (below) releases it
  // alongside the stock restock, whenever `restockItems` is non-null, so a
  // usage-capped code isn't permanently short one redemption for an order
  // that never actually shipped. (It's a no-op when there's no redemption
  // to release, e.g. no discount was ever applied.)
  let restockItems: { variantId: string; quantity: number }[] | null = null;
  // F-036 fix: an admin marking a RAZORPAY order PENDING_PAYMENT -> PAID
  // by hand (e.g. reconciling a payment the webhook never delivered) used
  // to skip stock/discount entirely — the order could then ship with
  // nothing ever decremented. Routed through the same
  // applyPaidSideEffects used by /api/checkout/verify and the webhook.
  let isManualPaidTransition = false;
  // F-205 fix: a caller (only reachable via a direct API call today — the
  // admin UI never sends `status` unless it actually changed) that resends
  // the order's current status used to still write a `fromStatus ===
  // toStatus` audit row, purely because the metadata assembly below only
  // checked `input.status !== undefined` rather than whether it actually
  // differed from `existing.status`. That's noise on the timeline this
  // finding adds — computed once here (kept in sync with the `if` below,
  // which needs the full non-undefined check for its own type narrowing)
  // so the metadata and notify steps further down agree on what counts as
  // "changed".
  const statusChanged = input.status !== undefined && input.status !== existing.status;

  if (input.status !== undefined && input.status !== existing.status) {
    assertValidOrderStatusTransition(existing.status, input.status);
    if (input.status === "SHIPPED") {
      const trackingNumber = input.trackingNumber ?? existing.trackingNumber;
      const courier = input.courier ?? existing.courier;
      if (!trackingNumber || !courier) {
        throw new MissingTrackingInfoError();
      }
    }

    // F-282 fix: a paid Razorpay order's status has no effect on the
    // customer's money — see RefundAcknowledgementRequiredError's doc
    // comment. Gate this before anything else runs.
    if (
      existing.paymentMethod === "RAZORPAY" &&
      existing.razorpayPaymentId !== null &&
      (input.status === "CANCELLED" || input.status === "REFUNDED") &&
      !input.acknowledgeExternalRefund
    ) {
      throw new RefundAcknowledgementRequiredError();
    }

    data.status = input.status;
    // F-334: record when this step was actually reached, so the
    // customer-facing timeline (wave-4's order-status-workflow-and-
    // timeline package) has a real date to render instead of none at all.
    const timestampField = orderStatusTimestampField(input.status);
    if (timestampField) {
      data[timestampField] = new Date();
    }

    const stockCommitted =
      existing.paymentMethod === "ORDER_REQUEST" ||
      (existing.paymentMethod === "RAZORPAY" && (existing.status === "PAID" || existing.status === "PROCESSING"));
    if ((input.status === "CANCELLED" || input.status === "REFUNDED") && stockCommitted) {
      restockItems = existing.items
        .filter((item): item is typeof item & { variantId: string } => item.variantId !== null)
        .map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
    }

    if (
      existing.paymentMethod === "RAZORPAY" &&
      existing.status === "PENDING_PAYMENT" &&
      input.status === "PAID"
    ) {
      isManualPaidTransition = true;
    }
  }

  if (input.trackingNumber !== undefined) data.trackingNumber = input.trackingNumber;
  if (input.courier !== undefined) data.courier = input.courier;
  if (input.adminNotes !== undefined) data.adminNotes = input.adminNotes;

  // F-335 fix: this used to be two code paths — an unconditional
  // `db.order.update` for most edits, and only the restock branch wrapped
  // in a compare-and-swap transaction. That let two concurrent updates
  // (e.g. one admin shipping an order the instant another admin cancels
  // it) both "succeed": both read the same pre-update status, so both
  // passed transition validation, and the unconditional `update` let
  // whichever one committed last silently win with no 409 — see the F-335
  // finding for the exact repro (SHIPPED with tracking info, but stock and
  // the discount redemption already restored by the "losing" cancel).
  // Every update now goes through the same guarded transaction, whether or
  // not it restocks/releases anything.
  //
  // F-255 fix: an explicit timeout/maxWait, same as create-order.ts's
  // checkout transaction — this one is normally a single-order update, but
  // the restock branch used to be a per-line loop (now `releaseOrderInventory`'s
  // single bulk statement — see its doc comment), so this is a cheap safety
  // net rather than something this transaction is expected to need.
  let restockedUnits = 0;
  const updated: Order = await db.$transaction(
    async (tx) => {
      const result = await tx.order.updateMany({
        where: { id, status: existing.status, updatedAt: existing.updatedAt },
        data,
      });
      if (result.count === 0) {
        throw new OrderUpdateConflictError(id);
      }

      if (isManualPaidTransition) {
        await applyPaidSideEffects(tx, existing);
      }
      if (restockItems) {
        const release = await releaseOrderInventory(tx, { id, discountId: existing.discountId, items: restockItems });
        restockedUnits = release.restockedUnits;
      }
      return tx.order.findUniqueOrThrow({ where: { id } });
    },
    { timeout: 15_000, maxWait: 5_000 },
  );

  // release-hardening audit F-017: a manual PENDING_PAYMENT -> PAID
  // decrements stock, and a cancel/refund restocks it — without this, the
  // PDP/listing cache keeps serving the pre-mutation stock/availability
  // until an unrelated admin catalog edit happens to revalidate the same
  // tags. The two branches above are mutually exclusive (a status can only
  // transition one way at a time), so at most one of these ever has ids.
  // Best-effort — must never fail an update that already committed.
  const stockMutatedVariantIds = isManualPaidTransition
    ? existing.items.map((item) => item.variantId).filter((v): v is string => v !== null)
    : (restockItems?.map((item) => item.variantId) ?? []);
  if (stockMutatedVariantIds.length > 0) {
    await revalidateProductStockForVariants(stockMutatedVariantIds);
  }

  await logAuditEvent({
    userId,
    action: "update",
    entity: "order",
    entityId: id,
    metadata: {
      ...(statusChanged ? { fromStatus: existing.status, toStatus: input.status } : {}),
      ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber } : {}),
      ...(input.courier !== undefined ? { courier: input.courier } : {}),
      ...(input.adminNotes !== undefined ? { adminNotesUpdated: true } : {}),
      ...(isManualPaidTransition ? { manualPaidTransition: true } : {}),
      ...(restockedUnits > 0 ? { restockedUnits } : {}),
    },
  });

  // F-067 fix: the payment-received email promises "we'll let you know as
  // soon as it ships" (src/lib/orders/notify.ts) — this is what actually
  // keeps that promise for the transitions that matter to a shopper. Fired
  // only on an actual status change (not a tracking/notes-only edit), and
  // after the transaction above has already committed, so a notification
  // failure can never roll back the status change or the restock.
  // notifyOrderStatusChange is itself fully best-effort (never throws),
  // same contract as notifyNewOrder.
  if (
    statusChanged &&
    (updated.status === "SHIPPED" || updated.status === "CANCELLED" || updated.status === "REFUNDED")
  ) {
    await notifyOrderStatusChange({
      orderNumber: updated.number,
      email: updated.email,
      toStatus: updated.status,
      trackingNumber: updated.trackingNumber,
      courier: updated.courier,
      paymentMethod: existing.paymentMethod,
      hasCapturedPayment: existing.razorpayPaymentId !== null,
    });
  }

  return updated;
}
