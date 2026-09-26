import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { Customer } from "@/generated/prisma/client";
import { logAuditEvent } from "@/lib/auth/audit";

/**
 * Phase D4: admin customer listing, detail (with order/review history) and
 * active/inactive toggle, built on top of D1's `Customer` model.
 *
 * F-198 fix: "Total spent" used to be computed from orders with status
 * PAID or later in the lifecycle (PAID, PROCESSING, SHIPPED, DELIVERED),
 * with a comment calling that "money actually received". That's true for
 * Razorpay orders — Razorpay only reaches those statuses once it has
 * actually captured payment — but every ORDER_REQUEST order (the fallback
 * used whenever Razorpay isn't configured — i.e. every local/dev order, and
 * any production order placed before Razorpay is set up) is created
 * straight into PROCESSING with no payment step at all (see
 * src/lib/orders/create-order.ts). So an unpaid, just-placed order request
 * counted as revenue the moment it was placed. There's no `paidAt`/"paid"
 * flag on Order to check instead, so `isRevenueOrder` below draws the line
 * per payment method: a Razorpay order counts once captured; an
 * ORDER_REQUEST order counts once it has actually shipped (by then staff
 * have manually confirmed and collected payment) — a business-policy
 * choice the owner can revisit once a real `paidAt` column exists.
 *
 * "Orders" is now a *separate* count of every order regardless of payment
 * status (so it matches the order list shown on the customer detail page),
 * aggregated with a single `groupBy` per metric over all matching orders
 * rather than one query per customer, so listing N customers never costs
 * N+1 queries.
 */

const RAZORPAY_REVENUE_STATUSES = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] as const;
const ORDER_REQUEST_REVENUE_STATUSES = ["SHIPPED", "DELIVERED"] as const;

/** Shared by the list (SQL `where`, see REVENUE_WHERE) and the detail view
 * (a JS filter over an already-loaded order list) so both agree on exactly
 * which orders count as real revenue. */
function isRevenueOrder(paymentMethod: string, status: string): boolean {
  if (paymentMethod === "RAZORPAY") {
    return (RAZORPAY_REVENUE_STATUSES as readonly string[]).includes(status);
  }
  if (paymentMethod === "ORDER_REQUEST") {
    return (ORDER_REQUEST_REVENUE_STATUSES as readonly string[]).includes(status);
  }
  return false;
}

const REVENUE_WHERE: Prisma.OrderWhereInput = {
  OR: [
    { paymentMethod: "RAZORPAY", status: { in: [...RAZORPAY_REVENUE_STATUSES] } },
    { paymentMethod: "ORDER_REQUEST", status: { in: [...ORDER_REQUEST_REVENUE_STATUSES] } },
  ],
};

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

  // F-224 fix (release-hardening schema-foundation): this used to load
  // every matching customer, aggregate spend across all of them, then
  // slice one page out in JS — so every admin page view transferred the
  // whole table. `count` + `skip`/`take` (with `id` as a tie-breaker,
  // same reasoning as admin-orders.ts's buildOrderOrderBy) now do the
  // paging in the database; the `aggregates` groupBy below is unchanged
  // but now naturally scopes to just this page's customer ids, since
  // `customers` itself is only ever this page's rows.
  const total = await db.customer.count({ where });
  const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), totalPages);
  const skip = (page - 1) * pageSize;

  const customers = await db.customer.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take: pageSize,
  });

  const customerIds = customers.map((c) => c.id);
  // Two separate aggregates, run in parallel (still no N+1: both are one
  // query each, scoped to just this page's customer ids) — F-198 fix:
  // "orders placed" and "revenue" are no longer the same query. A customer
  // whose only order is a CANCELLED or still-PROCESSING order request now
  // shows an accurate order count with ₹0 spent, instead of 0 orders shown
  // while their detail page lists one.
  const [allOrdersAgg, revenueAgg] = await Promise.all([
    db.order.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds } },
      _count: { _all: true },
    }),
    db.order.groupBy({
      by: ["customerId"],
      where: { customerId: { in: customerIds }, ...REVENUE_WHERE },
      _sum: { total: true },
    }),
  ]);
  const orderCountByCustomer = new Map(allOrdersAgg.map((a) => [a.customerId as string, a._count._all]));
  const revenueByCustomer = new Map(revenueAgg.map((a) => [a.customerId as string, a._sum.total]));

  const items: AdminCustomerListItem[] = customers.map((c) => {
    const revenue = revenueByCustomer.get(c.id);
    return {
      id: c.id,
      email: c.email,
      name: c.name,
      phone: c.phone,
      emailVerified: c.emailVerifiedAt !== null,
      active: c.active,
      orderCount: orderCountByCustomer.get(c.id) ?? 0,
      totalSpent: revenue ? Number(revenue) : 0,
      createdAt: c.createdAt,
    };
  });

  return { items, total, page, pageSize, totalPages };
}

// ---------------------------------------------------------------------------
// Guest buyers
// ---------------------------------------------------------------------------

export interface AdminGuestBuyer {
  email: string;
  orderCount: number;
  totalSpent: number;
  lastOrderAt: Date;
}

export interface ListGuestBuyersForAdminOptions {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListGuestBuyersForAdminResult {
  items: AdminGuestBuyer[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * F-198 fix: most orders in this store are guest checkouts (no `Customer`
 * account — see docs/ROLES.md-adjacent claim guest-orders flow at
 * src/lib/orders/claim-guest-orders.ts), and they never showed up anywhere
 * in /admin/customers — a buyer who ordered five times as a guest looked,
 * to an admin searching by email, like they didn't exist.
 *
 * A guest isn't a `Customer` row, so this aggregates `Order` directly by
 * email instead of extending listCustomersForAdmin — there's no id to page
 * detail views by, and "customer" here means "a group of guest orders
 * sharing an email", not an account. Kept intentionally simple (no DB-side
 * total count query beyond one `findMany({distinct})`) since this is an
 * admin-only report at this store's scale, not a customer-facing list.
 */
export async function listGuestBuyersForAdmin(
  options: ListGuestBuyersForAdminOptions = {},
): Promise<ListGuestBuyersForAdminResult> {
  const where: Prisma.OrderWhereInput = { customerId: null };
  if (options.search && options.search.trim()) {
    where.email = { contains: options.search.trim(), mode: "insensitive" };
  }

  const distinctEmails = await db.order.findMany({ where, distinct: ["email"], select: { email: true } });
  const total = distinctEmails.length;
  const pageSize = Math.min(Math.max(options.pageSize ?? 24, 1), 100);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(options.page ?? 1, 1), totalPages);

  const grouped = await db.order.groupBy({
    by: ["email"],
    where,
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  const pageEmails = grouped.map((g) => g.email);
  const revenueAgg =
    pageEmails.length > 0
      ? await db.order.groupBy({
          by: ["email"],
          where: { customerId: null, email: { in: pageEmails }, ...REVENUE_WHERE },
          _sum: { total: true },
        })
      : [];
  const revenueByEmail = new Map(revenueAgg.map((r) => [r.email, r._sum.total]));

  const items: AdminGuestBuyer[] = grouped.map((g) => {
    const revenue = revenueByEmail.get(g.email);
    return {
      email: g.email,
      orderCount: g._count._all,
      totalSpent: revenue ? Number(revenue) : 0,
      // Always set: every row in `grouped` comes from at least one order.
      lastOrderAt: g._max.createdAt!,
    };
  });

  return { items, total, page, pageSize, totalPages };
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
      orders: {
        orderBy: { createdAt: "desc" },
        select: { id: true, number: true, status: true, paymentMethod: true, total: true, currency: true, createdAt: true },
      },
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

  const revenueOrders = customer.orders.filter((o) => isRevenueOrder(o.paymentMethod, o.status));

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
    // F-198 fix: orderCount is now every order (matching the `orders` list
    // right below), not just the ones that count as revenue.
    orderCount: customer.orders.length,
    totalSpent: revenueOrders.reduce((sum, o) => sum + Number(o.total), 0),
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

/** F-197 fix: the narrow, safe shape `setCustomerActive` returns — never
 * the full Prisma `Customer` row, which also carries `passwordHash` and
 * the login-lockout fields (`failedLoginCount`, `lockedUntil`,
 * `lastFailedLoginAt`). Every field the PATCH route or its only caller
 * (customer-active-toggle.tsx, which doesn't even read the body) could
 * plausibly need, and nothing more. */
export type AdminCustomerActiveResult = Pick<
  Customer,
  "id" | "email" | "name" | "active" | "sessionVersion" | "updatedAt"
>;

const CUSTOMER_ACTIVE_SELECT = {
  id: true,
  email: true,
  name: true,
  active: true,
  sessionVersion: true,
  updatedAt: true,
} satisfies Prisma.CustomerSelect;

export async function setCustomerActive(
  id: string,
  active: boolean,
  userId: string,
): Promise<AdminCustomerActiveResult> {
  // F-197 fix: select only `{ id: true }` here too, so the full row
  // (passwordHash included) is never loaded into memory just to check
  // existence.
  const existing = await db.customer.findUnique({ where: { id }, select: { id: true } });
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
    select: CUSTOMER_ACTIVE_SELECT,
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
