import { db } from "@/lib/db";
import Link from "next/link";

export default async function AdminDashboardPage() {
  const [leadCount, blogCount, subscriberCount, pendingCampaigns, pendingHermes, recentLeads, recentLogs] =
    await Promise.all([
    db.bulkOrderLead.count(),
    db.blogPostRecord.count({ where: { status: "PUBLISHED" } }),
    db.newsletterSubscriber.count(),
    db.campaign.count({ where: { status: "PENDING_APPROVAL" } }),
    db.hermesApproval.count({ where: { status: "PENDING" } }),
    db.bulkOrderLead.findMany({ orderBy: { createdAt: "desc" }, take: 5 }),
    db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  const newLeads = await db.bulkOrderLead.count({ where: { status: "NEW" } });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Dashboard</h1>
        <p className="text-muted">Overview of storefront content and bulk enquiries.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Bulk Enquiries" value={String(leadCount)} hint={`${newLeads} new`} />
        <StatCard label="Newsletter Subscribers" value={String(subscriberCount)} hint="Footer signups" />
        <StatCard label="Published Articles" value={String(blogCount)} hint="Journal posts live" />
        <StatCard label="Campaigns Pending" value={String(pendingCampaigns)} hint="Awaiting approval" />
        <StatCard label="Hermes Pending" value={String(pendingHermes)} hint="Recommendations queue" />
      </div>

      <div className="rounded-2xl border border-border bg-lavender/20 p-4">
        <Link href="/admin/reports" className="text-sm font-semibold text-brand hover:underline">
          View Weekly Growth Report →
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border border-border bg-white p-6">
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

        <section className="rounded-3xl border border-border bg-white p-6">
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
    <div className="rounded-3xl border border-border bg-white p-6">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-3xl font-bold text-brand">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
