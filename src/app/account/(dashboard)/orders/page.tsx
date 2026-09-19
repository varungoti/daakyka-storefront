import { EmptyState } from "@/components/account/account-tabs";
import { OrderStatusBadge } from "@/components/account/order-status-badge";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { listOrdersForCustomer } from "@/lib/orders/customer-orders";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";

export const metadata: Metadata = { title: "My Orders" };

// Zod per this repo's "Zod for any new input" convention — `page` is a
// user-controlled URL query param. `.catch(1)` rather than throwing: an
// out-of-range or garbage page number is cosmetic here, not a security
// concern, so it should just fall back to page 1 instead of 500ing.
const pageParamSchema = z.coerce.number().int().min(1).max(100_000).catch(1);

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(
    amount,
  );
}

function formatOrderDate(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Release-hardening item 2 (Medium parity gap — see
 * docs/audit-2026-09-19/storefront-ux.md's "Order tracking page" row):
 * the signed-in customer's order history. Auth is enforced structurally
 * by src/app/account/(dashboard)/layout.tsx (this page can't render for
 * a logged-out visitor); the session is re-read here only to get
 * `session.id` for the scoped query, per the layout's own doc comment.
 */
export default async function AccountOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await getCustomerSession();
  if (!session) redirect("/account/login?returnTo=/account/orders");

  const { page: rawPage } = await searchParams;
  const page = pageParamSchema.parse(rawPage);

  const { items, page: currentPage, totalPages, total } = await listOrdersForCustomer(session.id, { page });

  if (total === 0) {
    return (
      <EmptyState
        title="No Orders Yet"
        description="Once you place an order, it will show up here with its status and tracking details."
        actionHref="/shop"
        actionLabel="Start Shopping"
      />
    );
  }

  return (
    <div className="space-y-4">
      {items.map((order) => (
        <Link
          key={order.id}
          href={`/account/orders/${order.number}`}
          className="block rounded-2xl border border-border p-5 transition hover:border-brand"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-ink">{order.number}</p>
              <p className="text-sm text-muted">
                Placed {formatOrderDate(order.createdAt)} · {order.itemCount} item
                {order.itemCount === 1 ? "" : "s"}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <OrderStatusBadge status={order.status} paymentMethod={order.paymentMethod} />
              <p className="font-display text-lg font-bold text-ink">{formatInr(order.total)}</p>
            </div>
          </div>
        </Link>
      ))}

      {totalPages > 1 && (
        <nav className="flex items-center justify-between pt-4 text-sm" aria-label="Order pagination">
          {currentPage > 1 ? (
            <Link href={`/account/orders?page=${currentPage - 1}`} className="font-semibold text-brand hover:underline">
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {currentPage} of {totalPages}
          </span>
          {currentPage < totalPages ? (
            <Link href={`/account/orders?page=${currentPage + 1}`} className="font-semibold text-brand hover:underline">
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
