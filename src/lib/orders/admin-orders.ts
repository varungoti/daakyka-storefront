import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { Order, OrderItem, OrderStatus, PaymentMethod } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";
import { assertValidOrderStatusTransition } from "@/lib/orders/status-transitions";
import { buildOrdersCsv, type OrderCsvRow } from "@/lib/orders/csv";

/**
 * Phase D4: admin order listing, detail, status-transition and CSV-export
 * service layer, built on top of D3's `Order`/`OrderItem` models. Filtering,
 * sorting and pagination follow the same in-memory-after-a-DB-filter
 * pattern as `listProductsForAdmin` (src/lib/catalog/products.ts), for
 * consistency and because the row counts here are small enough that it
 * isn't worth a second, differently-shaped query path.
 */

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
  itemCount: number;
  subtotal: number;
  shipping: number;
  discount: number;
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

function buildOrderWhere(options: {
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
}): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (options.status) where.status = options.status;
  if (options.paymentMethod) where.paymentMethod = options.paymentMethod;
  if (options.search && options.search.trim()) {
    const term = options.search.trim();
    where.OR = [
      { number: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
    ];
  }
  if (options.dateFrom || options.dateTo) {
    where.createdAt = {
      ...(options.dateFrom ? { gte: options.dateFrom } : {}),
      ...(options.dateTo ? { lte: options.dateTo } : {}),
    };
  }
  return where;
}

async function fetchOrdersForAdmin(where: Prisma.OrderWhereInput): Promise<AdminOrderListItem[]> {
  const rows = await db.order.findMany({
    where,
    include: {
      customer: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    email: row.email,
    phone: row.phone,
    customerName: row.customer?.name ?? null,
    itemCount: row._count.items,
    subtotal: Number(row.subtotal),
    shipping: Number(row.shipping),
    discount: Number(row.discount),
    total: Number(row.total),
    currency: row.currency,
    status: row.status,
    paymentMethod: row.paymentMethod,
    trackingNumber: row.trackingNumber,
    courier: row.courier,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listOrdersForAdmin(
  options: ListOrdersForAdminOptions = {},
): Promise<ListOrdersForAdminResult> {
  const where = buildOrderWhere(options);
  const items = await fetchOrdersForAdmin(where);

  const sort = options.sort ?? "createdAt-desc";
  items.sort((a, b) => {
    switch (sort) {
      case "createdAt-asc":
        return a.createdAt.getTime() - b.createdAt.getTime();
      case "total-desc":
        return b.total - a.total;
      case "total-asc":
        return a.total - b.total;
      case "createdAt-desc":
      default:
        return b.createdAt.getTime() - a.createdAt.getTime();
    }
  });

  const total = items.length;
  const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), totalPages);
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return { items: paged, total, page, pageSize, totalPages };
}

export async function exportOrdersCsv(
  options: Omit<ListOrdersForAdminOptions, "sort" | "page" | "pageSize"> = {},
): Promise<string> {
  const where = buildOrderWhere(options);
  const items = await fetchOrdersForAdmin(where);
  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const rows: OrderCsvRow[] = items.map((item) => ({
    number: item.number,
    email: item.email,
    phone: item.phone,
    status: item.status,
    paymentMethod: item.paymentMethod,
    itemCount: item.itemCount,
    subtotal: item.subtotal,
    shipping: item.shipping,
    discount: item.discount,
    total: item.total,
    currency: item.currency,
    trackingNumber: item.trackingNumber,
    courier: item.courier,
    createdAt: item.createdAt,
  }));

  return buildOrdersCsv(rows);
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

const ORDER_DETAIL_INCLUDE = {
  customer: { select: { id: true, name: true, email: true } },
  items: { orderBy: { createdAt: "asc" } },
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
}

export interface AdminOrderDetail {
  id: string;
  number: string;
  customerId: string | null;
  customerName: string | null;
  email: string;
  phone: string | null;
  shippingAddress: unknown;
  subtotal: number;
  shipping: number;
  discount: number;
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
}

export function serializeOrderDetail(row: OrderDetailRow): AdminOrderDetail {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    email: row.email,
    phone: row.phone,
    shippingAddress: row.shippingAddress,
    subtotal: Number(row.subtotal),
    shipping: Number(row.shipping),
    discount: Number(row.discount),
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
    items: row.items.map((item: OrderItem) => ({
      id: item.id,
      productName: item.productName,
      variantLabel: item.variantLabel,
      sku: item.sku,
      unitPrice: Number(item.unitPrice),
      quantity: item.quantity,
      imageUrl: item.imageUrl,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getOrderForAdmin(id: string): Promise<AdminOrderDetail> {
  const row = await db.order.findUnique({ where: { id }, include: ORDER_DETAIL_INCLUDE });
  if (!row) throw new OrderNotFoundError(id);
  return serializeOrderDetail(row);
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
  })
  .refine((data) => data.status !== undefined || data.trackingNumber !== undefined || data.courier !== undefined || data.adminNotes !== undefined, {
    message: "At least one field (status, trackingNumber, courier, adminNotes) is required",
  });

export type OrderUpdateInput = z.infer<typeof orderUpdateSchema>;

export async function updateOrderAdmin(id: string, input: OrderUpdateInput, userId: string): Promise<Order> {
  const existing = await db.order.findUnique({ where: { id }, include: { items: true } });
  if (!existing) throw new OrderNotFoundError(id);

  const data: Prisma.OrderUpdateInput = {};
  // Finding B (release-hardening): an ORDER_REQUEST order decrements stock
  // immediately at creation (see createOrderFromCart's docstring) because
  // it has no payment step to gate on — unlike a RAZORPAY order, which
  // never decrements until payment is verified, so cancelling one
  // pre-payment has nothing to give back (see the cancel-stale-orders
  // cron). If an ORDER_REQUEST order is cancelled before it ships, that
  // stock was never actually sold, so it's released back to inventory
  // here. PROCESSING -> CANCELLED is the only path to CANCELLED an
  // ORDER_REQUEST order can take (see status-transitions.ts — SHIPPED has
  // no CANCELLED edge), so this is the only point its stock was ever
  // committed, and `restockItems` is only ever computed once per order.
  let restockItems: { variantId: string; quantity: number }[] | null = null;

  if (input.status !== undefined && input.status !== existing.status) {
    assertValidOrderStatusTransition(existing.status, input.status);
    if (input.status === "SHIPPED") {
      const trackingNumber = input.trackingNumber ?? existing.trackingNumber;
      const courier = input.courier ?? existing.courier;
      if (!trackingNumber || !courier) {
        throw new MissingTrackingInfoError();
      }
    }
    data.status = input.status;

    if (existing.paymentMethod === "ORDER_REQUEST" && input.status === "CANCELLED") {
      restockItems = existing.items
        .filter((item): item is typeof item & { variantId: string } => item.variantId !== null)
        .map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
    }
  }

  if (input.trackingNumber !== undefined) data.trackingNumber = input.trackingNumber;
  if (input.courier !== undefined) data.courier = input.courier;
  if (input.adminNotes !== undefined) data.adminNotes = input.adminNotes;

  let updated: Order;
  if (restockItems && restockItems.length > 0) {
    const itemsToRestock = restockItems;
    updated = await db.$transaction(async (tx) => {
      // Optimistic-concurrency guard, scoped to only this restocking path
      // (every other update below keeps the simple unconditional
      // `db.order.update` — adding this guard there too would make an
      // unrelated concurrent notes/tracking edit spuriously fail). The
      // `status: existing.status` condition means only one of two
      // concurrent cancel requests for the same order can ever win this
      // update; the loser's `count` comes back 0 and it throws instead of
      // also restocking — that's what prevents a double-restore.
      const result = await tx.order.updateMany({
        where: { id, status: existing.status },
        data,
      });
      if (result.count === 0) {
        throw new OrderUpdateConflictError(id);
      }
      for (const item of itemsToRestock) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } },
        });
      }
      return tx.order.findUniqueOrThrow({ where: { id } });
    });
  } else {
    updated = await db.order.update({ where: { id }, data });
  }

  await logAuditEvent({
    userId,
    action: "update",
    entity: "order",
    entityId: id,
    metadata: {
      ...(input.status !== undefined ? { fromStatus: existing.status, toStatus: input.status } : {}),
      ...(input.trackingNumber !== undefined ? { trackingNumber: input.trackingNumber } : {}),
      ...(input.courier !== undefined ? { courier: input.courier } : {}),
      ...(input.adminNotes !== undefined ? { adminNotesUpdated: true } : {}),
      ...(restockItems && restockItems.length > 0
        ? { restockedUnits: restockItems.reduce((sum, item) => sum + item.quantity, 0) }
        : {}),
    },
  });

  return updated;
}
