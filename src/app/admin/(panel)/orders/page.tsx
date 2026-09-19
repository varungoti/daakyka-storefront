import Link from "next/link";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getUndeliveredEmailCount } from "@/lib/engagement/outbox";
import { redirect } from "next/navigation";
import { OrdersTable } from "@/components/admin/orders-table";

/**
 * Phase D4: native-order admin, replacing the old Shopify-`OrderEvent`
 * placeholder that used to live at this route (it showed only webhook
 * events, no line items, no status control, no CSV export).
 *
 * Merge decision (documented per the phase brief): the old `OrderEvent`
 * table is Shopify webhook data with a completely different shape (no
 * items, no shipping address, a free-text `status` string, `total` as a
 * nullable Float) — folding its rows into this page's `Order` table would
 * mean inventing fake `OrderItem`/`shippingAddress` data for them. Instead
 * this page links out to `/admin/orders/shopify-legacy`, which keeps the
 * exact table the old page rendered, under a "Legacy Shopify Orders"
 * heading. The Shopify webhook route itself
 * (src/app/api/webhooks/shopify/orders/route.ts) is untouched.
 */
export default async function AdminOrdersPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "orders:view")) {
    redirect("/admin/dashboard");
  }

  const [legacyCount, undeliveredEmail] = await Promise.all([
    db.orderEvent.count(),
    // F7 fix: order confirmations are the highest-stakes transactional
    // email this store sends — surface undelivered ones right where the
    // store owner is already looking. See src/lib/engagement/outbox.ts.
    getUndeliveredEmailCount(),
  ]);
  const canManage = hasPermission(session.role, "orders:manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Orders</h1>
          <p className="text-muted">Native storefront orders — Razorpay payments and order requests.</p>
        </div>
        {legacyCount > 0 && (
          <Link
            href="/admin/orders/shopify-legacy"
            className="rounded-full border border-border px-4 py-2 text-xs font-semibold text-muted hover:bg-lavender/30"
          >
            Legacy Shopify Orders ({legacyCount}) →
          </Link>
        )}
      </div>

      {undeliveredEmail.total > 0 && (
        <Link
          href="/admin/notifications"
          className="block rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:bg-amber-100"
        >
          <strong>{undeliveredEmail.total}</strong> order-related email{undeliveredEmail.total === 1 ? "" : "s"} not
          yet delivered — some customers may not have received their confirmation. View details →
        </Link>
      )}

      {!canManage && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          You have view-only access. Status changes require the orders:manage permission.
        </p>
      )}

      <OrdersTable />
    </div>
  );
}
