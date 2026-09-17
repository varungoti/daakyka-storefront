import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { Customer } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";

/**
 * Phase D4: admin customer listing, detail (with order/review history) and
 * active/inactive toggle, built on top of D1's `Customer` model.
 *
 * "Total spent" is computed from orders with status PAID or later in the
 * lifecycle (PAID, PROCESSING, SHIPPED, DELIVERED — i.e. money actually
 * received; PENDING_PAYMENT hasn't been paid, CANCELLED/REFUNDED gave the
 * money back). It's aggregated with a single `groupBy` over all matching
 * orders rather than one query per customer, so listing N customers never
 * costs N+1 queries.
 */

const SPENT_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const;

export class CustomerNotFoundError extends Error {
  constructor(id: string) {
    super(`Customer ${id} not found`);
    this.name = "CustomerNotFoundError";
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface ListCustomersForAdminOptions {
  search?: string;
  active?: boolean;
  page?: number;
  pageSize?: number;
}

export interface AdminCustomerListItem {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  emailVerified: boolean;
  active: boolean;
  orderCount: number;
  totalSpent: number;
  createdAt: Date;
}

export interface ListCustomersForAdminResult {
  items: AdminCustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function listCustomersForAdmin(
  options: ListCustomersForAdminOptions = {},
): Promise<ListCustomersForAdminResult> {
  const where: Prisma.CustomerWhereInput = {};
  if (options.active !== undefined) where.active = options.active;
  if (options.search && options.search.trim()) {
    const term = options.search.trim();
    where.OR = [
      { name: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
      { phone: { contains: term, mode: "insensitive" } },
    ];
  }

  const customers = await db.customer.findMany({ where, orderBy: { createdAt: "desc" } });

  const aggregates = await db.order.groupBy({
    by: ["customerId"],
    where: { customerId: { in: customers.map((c) => c.id) }, status: { in: [...SPENT_STATUSES] } },
    _count: { _all: true },
    _sum: { total: true },
  });
  const aggByCustomer = new Map(aggregates.map((a) => [a.customerId as string, a]));

  const items: AdminCustomerListItem[] = customers.map((c) => {
    const agg = aggByCustomer.get(c.id);
    return {
      id: c.id,
      email: c.email,
      name: c.name,
      phone: c.phone,
      emailVerified: c.emailVerifiedAt !== null,
      active: c.active,
      orderCount: agg?._count._all ?? 0,
      totalSpent: agg?._sum.total ? Number(agg._sum.total) : 0,
      createdAt: c.createdAt,
    };
  });

  const total = items.length;
  const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), totalPages);
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);

  return { items: paged, total, page, pageSize, totalPages };
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export interface AdminCustomerAddress {
  id: string;
  label: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

export interface AdminCustomerOrderSummary {
  id: string;
  number: string;
  status: string;
  total: number;
  currency: string;
  createdAt: Date;
}

export interface AdminCustomerReviewSummary {
  id: string;
  productName: string;
  productSlug: string;
  rating: number;
  status: string;
  createdAt: Date;
}

export interface AdminCustomerDetail {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  emailVerified: boolean;
  active: boolean;
  createdAt: Date;
  addresses: AdminCustomerAddress[];
  orders: AdminCustomerOrderSummary[];
  orderCount: number;
  totalSpent: number;
  reviews: AdminCustomerReviewSummary[];
}

export async function getCustomerForAdmin(id: string): Promise<AdminCustomerDetail> {
  const customer = await db.customer.findUnique({
    where: { id },
    include: {
      addresses: { orderBy: { isDefault: "desc" } },
      orders: { orderBy: { createdAt: "desc" }, select: { id: true, number: true, status: true, total: true, currency: true, createdAt: true } },
      // Read-only: product name/rating/status for the customer's review
      // history. This queries the shared `Review` model directly rather
      // than importing anything from src/lib/reviews/* or the /admin/reviews
      // moderation UI, both of which are Phase D2's concurrent surface.
      reviews: {
        orderBy: { createdAt: "desc" },
        include: { product: { select: { name: true, slug: true } } },
      },
    },
  });
  if (!customer) throw new CustomerNotFoundError(id);

  const spentOrders = customer.orders.filter((o) => (SPENT_STATUSES as readonly string[]).includes(o.status));

  return {
    id: customer.id,
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    emailVerified: customer.emailVerifiedAt !== null,
    active: customer.active,
    createdAt: customer.createdAt,
    addresses: customer.addresses.map((a) => ({
      id: a.id,
      label: a.label,
      line1: a.line1,
      line2: a.line2,
      city: a.city,
      state: a.state,
      postalCode: a.postalCode,
      country: a.country,
      phone: a.phone,
      isDefault: a.isDefault,
    })),
    orders: customer.orders.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      total: Number(o.total),
      currency: o.currency,
      createdAt: o.createdAt,
    })),
    orderCount: spentOrders.length,
    totalSpent: spentOrders.reduce((sum, o) => sum + Number(o.total), 0),
    reviews: customer.reviews.map((r) => ({
      id: r.id,
      productName: r.product.name,
      productSlug: r.product.slug,
      rating: r.rating,
      status: r.status,
      createdAt: r.createdAt,
    })),
  };
}

// ---------------------------------------------------------------------------
// Update (active/inactive)
// ---------------------------------------------------------------------------

export async function setCustomerActive(id: string, active: boolean, userId: string): Promise<Customer> {
  const existing = await db.customer.findUnique({ where: { id } });
  if (!existing) throw new CustomerNotFoundError(id);

  const updated = await db.customer.update({
    where: { id },
    data: {
      active,
      // Mirrors D1's password-reset revocation (src/app/api/account/reset-password/route.ts):
      // bumping sessionVersion invalidates every existing session token for
      // this customer, cutting off active sessions the moment they're
      // deactivated. Reactivating doesn't need to bump it again — the
      // customer will simply need to log in again either way.
      ...(active === false ? { sessionVersion: { increment: 1 } } : {}),
    },
  });

  await logAuditEvent({
    userId,
    action: active ? "activate" : "deactivate",
    entity: "customer",
    entityId: id,
    metadata: { active },
  });

  return updated;
}
