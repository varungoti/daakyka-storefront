import Link from "next/link";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

/**
 * Phase D4: the pre-D4 `/admin/orders` page, kept verbatim (same query,
 * same table) under its own route once `/admin/orders` became the native
 * `Order` admin. See the comment on that page for why these aren't merged
 * into one table. Reachable with either `orders:view` (the new Orders
 * section) or `bulk-orders:manage` (the permission this page originally
 * required, so roles that could already see it — e.g. BULK_ORDER_MANAGER,
 * SUPPORT_AGENT — still can).
 */
export default async function AdminShopifyLegacyOrdersPage() {
  const session = await getSession();
  if (!session || !(hasPermission(session.role, "orders:view") || hasPermission(session.role, "bulk-orders:manage"))) {
    redirect("/admin/dashboard");
  }

  const orders = await db.orderEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const totalRevenue = orders.reduce((sum, order) => sum + (order.total ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/orders" className="text-xs font-semibold text-brand hover:underline">
          ← Back to Orders
        </Link>
        <h1 className="mt-2 font-display text-3xl font-bold text-ink">Legacy Shopify Orders</h1>
        <p className="text-muted">
          Order events from Shopify webhooks — used for post-purchase journeys and revenue tracking before the
          native catalog/checkout shipped. Not part of the `Order` table above.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Recent Orders" value={String(orders.length)} />
        <StatCard
          label="Recorded Revenue"
          value={`₹${totalRevenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
        />
        <StatCard label="With Email" value={String(orders.filter((o) => o.email).length)} />
      </div>

      <div className="overflow-x-auto rounded-3xl border border-border bg-surface-elevated">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Order</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-border/70 align-top">
                <td className="px-4 py-4">
                  <p className="font-semibold text-ink">{order.externalId ?? order.id.slice(0, 8)}</p>
                </td>
                <td className="px-4 py-4">
                  {order.email && <p className="text-ink">{order.email}</p>}
                  {order.phone && <p className="text-muted">{order.phone}</p>}
                  {!order.email && !order.phone && <p className="text-muted">—</p>}
                </td>
                <td className="px-4 py-4 text-ink">
                  {order.total != null
                    ? `₹${order.total.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
                    : "—"}
                </td>
                <td className="px-4 py-4">
                  <span className="rounded-full bg-lavender/50 px-2.5 py-1 text-xs font-medium">
                    {order.status}
                  </span>
                </td>
                <td className="px-4 py-4 text-muted">{order.source}</td>
                <td className="px-4 py-4 text-muted">{order.createdAt.toLocaleString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && (
          <p className="p-8 text-center text-muted">
            No orders yet — connect Shopify and register the orders webhook at{" "}
            <code className="text-xs">/api/webhooks/shopify/orders</code>.
          </p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl border border-border bg-surface-elevated p-6">
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-ink">{value}</p>
    </div>
  );
}
