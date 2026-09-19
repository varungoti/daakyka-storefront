import { db } from "@/lib/db";
import Link from "next/link";
import { countDraftProductsAwaitingPublish, countLowStockVariants } from "@/lib/catalog/products";
import { getUndeliveredEmailCount } from "@/lib/engagement/outbox";

export default async function AdminDashboardPage() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    leadCount,
    blogCount,
    subscriberCount,
    pendingCampaigns,
    pendingHermes,
    draftProducts,
    lowStockVariants,
    ordersTodayCount,
    ordersTodayRevenue,
    recentLeads,
    recentLogs,
    undeliveredEmail,
  ] = await Promise.all([
    db.bulkOrderLead.count(),
    db.blogPostRecord.count({ where: { status: "PUBLISHED" } }),
    db.newsletterSubscriber.count(),
    db.campaign.count({ where: { status: "PENDING_APPROVAL" } }),
    db.hermesApproval.count({ where: { status: "PENDING" } }),
    countDraftProductsAwaitingPublish(),
    countLowStockVariants(),
    // Phase D4: orders admin — "Orders Today" card.
    db.order.count({ where: { createdAt: { gte: startOfToday } } }),
    db.order.aggregate({ where: { createdAt: { gte: startOfToday } }, _sum: { total: true } }),
    db.bulkOrderLead.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { name: true, email: true } } },
    }),
    // F7 fix: undelivered transactional email (EmailOutbox PENDING/FAILED)
    // — see src/lib/engagement/outbox.ts. getUndeliveredEmailCount() never
    // throws, so a hiccup here can't break the rest of the dashboard.
    getUndeliveredEmailCount(),
  ]);

  const newLeads = await db.bulkOrderLead.count({ where: { status: "NEW" } });
  const ordersTodayRevenueTotal = Number(ordersTodayRevenue._sum.total ?? 0);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Dashboard</h1>
        <p className="text-muted">Overview of storefront content and bulk enquiries.</p>
      </div>

      {undeliveredEmail.total > 0 && (
        <Link
          href="/admin/notifications"
          className="block rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 hover:bg-amber-100"
        >
          <strong>{undeliveredEmail.total}</strong> transactional email
          {undeliveredEmail.total === 1 ? "" : "s"} undelivered
          {undeliveredEmail.failed > 0 ? ` (${undeliveredEmail.failed} failed permanently)` : ""} — order
          confirmations, verification and reset links may not be reaching customers. View details →
        </Link>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Bulk Enquiries" value={String(leadCount)} hint={`${newLeads} new`} />
        <StatCard label="Newsletter Subscribers" value={String(subscriberCount)} hint="Footer signups" />
        <StatCard label="Published Articles" value={String(blogCount)} hint="Journal posts live" />
        <StatCard label="Campaigns Pending" value={String(pendingCampaigns)} hint="Awaiting approval" />
        <StatCard label="Hermes Pending" value={String(pendingHermes)} hint="Recommendations queue" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Link href="/admin/products?status=DRAFT">
          <StatCard label="Draft Products" value={String(draftProducts)} hint="Awaiting publish" />
        </Link>
        <Link href="/admin/products?stockFilter=low">
          <StatCard label="Low-Stock Variants" value={String(lowStockVariants)} hint="Active variants under 10 in stock" />
        </Link>
        <Link href="/admin/orders">
          <StatCard label="Orders Today" value={String(ordersTodayCount)} hint={`₹${ordersTodayRevenueTotal.toLocaleString("en-IN", { maximumFractionDigits: 0 })} placed today`} />
        </Link>
      </div>

      <div className="rounded-2xl border border-border bg-lavender/20 p-4">
        <Link href="/admin/reports" className="text-sm font-semibold text-brand hover:underline">
          View Weekly Growth Report →
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-ink">Recent Bulk Leads</h2>
            <Link href="/admin/bulk-orders" className="text-sm font-semibold text-brand hover:underline">
              View all
            </Link>
          </div>
          <ul className="space-y-3">
            {recentLeads.map((lead) => (
              <li key={lead.id} className="rounded-xl border border-border px-4 py-3">
                <p className="font-semibold text-ink">{lead.organization}</p>
                <p className="text-sm text-muted">
                  {lead.contactPerson} · {lead.status}
                </p>
              </li>
            ))}
            {recentLeads.length === 0 && (
              <p className="text-sm text-muted">No bulk enquiries yet.</p>
            )}
          </ul>
        </section>

        <section className="rounded-3xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-xl font-bold text-ink">Recent Activity</h2>
            <Link href="/admin/audit-logs" className="text-sm font-semibold text-brand hover:underline">
              Audit logs
            </Link>
          </div>
          <ul className="space-y-3">
            {recentLogs.map((log) => (
              <li key={log.id} className="rounded-xl border border-border px-4 py-3 text-sm">
                <p className="font-semibold text-ink">
                  {log.action} · {log.entity}
                </p>
                <p className="text-muted">
                  {log.user?.name ?? "System"} · {log.createdAt.toLocaleString("en-IN")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-3xl border border-border bg-surface p-6">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold text-brand">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
