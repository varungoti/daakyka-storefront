import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { CustomerNotFoundError, getCustomerForAdmin } from "@/lib/customers/admin-customers";
import { CustomerActiveToggle } from "@/components/admin/customer-active-toggle";

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
}

export default async function AdminCustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "customers:view")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;
  const customer = await getCustomerForAdmin(id).catch((err) => {
    if (err instanceof CustomerNotFoundError) return null;
    throw err;
  });
  if (!customer) notFound();

  const canManage = hasPermission(session.role, "customers:manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/customers" className="text-xs font-semibold text-brand hover:underline">
            ← Back to Customers
          </Link>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">{customer.name}</h1>
          <p className="text-muted">
            {customer.email} {customer.phone ? `· ${customer.phone}` : ""}
          </p>
        </div>
        {canManage && <CustomerActiveToggle customerId={customer.id} active={customer.active} />}
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Orders" value={String(customer.orderCount)} />
        <StatCard label="Total spent" value={formatInr(customer.totalSpent)} />
        <StatCard label="Verified" value={customer.emailVerified ? "Yes" : "No"} />
        <StatCard label="Joined" value={customer.createdAt.toLocaleDateString("en-IN")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Addresses</h2>
          {customer.addresses.length === 0 ? (
            <p className="text-sm text-muted">No saved addresses.</p>
          ) : (
            <div className="space-y-3">
              {customer.addresses.map((a) => (
                <div key={a.id} className="rounded-xl border border-border p-3 text-sm">
                  {a.label && <p className="text-xs font-semibold uppercase tracking-wide text-muted">{a.label}</p>}
                  <p className="text-ink">
                    {a.line1}
                    {a.line2 ? `, ${a.line2}` : ""}
                  </p>
                  <p className="text-muted">
                    {a.city}, {a.state} {a.postalCode}, {a.country}
                  </p>
                  {a.phone && <p className="text-muted">{a.phone}</p>}
                  {a.isDefault && <span className="mt-1 inline-block rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">Default</span>}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Order history</h2>
          {customer.orders.length === 0 ? (
            <p className="text-sm text-muted">No orders yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {customer.orders.map((o) => (
                <Link key={o.id} href={`/admin/orders/${o.id}`} className="flex items-center justify-between py-2 text-sm hover:underline">
                  <span className="text-ink">{o.number}</span>
                  <span className="text-muted">{o.status.replace("_", " ")}</span>
                  <span className="font-semibold text-ink">{formatInr(o.total)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
          <h2 className="mb-3 font-display text-lg font-bold text-ink">Review history</h2>
          {customer.reviews.length === 0 ? (
            <p className="text-sm text-muted">No reviews submitted.</p>
          ) : (
            <div className="divide-y divide-border">
              {customer.reviews.map((r) => (
                <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-ink">{r.productName}</span>
                  <span className="text-muted">{"★".repeat(r.rating)}</span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">{r.status}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-ink">{value}</p>
    </div>
  );
}
