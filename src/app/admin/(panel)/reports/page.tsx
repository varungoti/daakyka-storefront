import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import {
  buildWeeklyGrowthReport,
  formatWeeklyGrowthReportMarkdown,
} from "@/lib/reports/weekly-growth";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminReportsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "dashboard:view")) {
    redirect("/admin/dashboard");
  }

  const report = await buildWeeklyGrowthReport(7);
  const markdown = formatWeeklyGrowthReportMarkdown(report);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Weekly Growth Report</h1>
          <p className="text-muted">
            Last {report.periodDays} days — generated{" "}
            {new Date(report.generatedAt).toLocaleString("en-IN")}
          </p>
        </div>
        <Link
          href="/admin/hermes"
          className="rounded-xl border border-border bg-white px-4 py-2 text-sm font-semibold text-brand hover:bg-lavender/30"
        >
          Hermes Queue
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Orders" value={String(report.commerce.orders)} />
        <StatCard
          label="Revenue"
          value={`₹${report.commerce.revenueInr.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
        />
        <StatCard label="Product Views" value={String(report.commerce.productViews)} />
        <StatCard label="Newsletter Signups" value={String(report.leads.newsletterSignups)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ReportSection title="Commerce & Traffic">
          <MetricRow label="Cart abandonments" value={report.commerce.cartAbandonments} />
          <MetricRow label="Bulk order leads" value={report.leads.bulkOrders} />
          <MetricRow label="Contact enquiries" value={report.leads.contactEnquiries} />
        </ReportSection>

        <ReportSection title="Engagement">
          <MetricRow label="Active journey enrollments" value={report.engagement.activeJourneyEnrollments} />
          <MetricRow label="Journey events (period)" value={report.engagement.journeyEvents} />
          <MetricRow label="Campaigns pending approval" value={report.engagement.pendingCampaigns} />
          <MetricRow label="Campaigns sent (period)" value={report.engagement.sentCampaigns} />
          <MetricRow label="Hermes approvals pending" value={report.engagement.pendingHermesApprovals} />
        </ReportSection>

        <ReportSection title="Content & SEO">
          <MetricRow label="Published blog posts" value={report.content.publishedBlogPosts} />
          <MetricRow label="SEO pages healthy" value={report.content.seoPagesHealthy} />
          <MetricRow label="SEO pages needing work" value={report.content.seoPagesNeedingWork} />
          <MetricRow label="Product insights tracked" value={report.content.topProductInsights} />
        </ReportSection>

        <ReportSection title="Top Viewed Products">
          {report.topViewedProducts.length > 0 ? (
            <ul className="space-y-2">
              {report.topViewedProducts.map((product) => (
                <li key={product.handle} className="flex justify-between text-sm">
                  <Link href={`/products/${product.handle}`} className="font-medium text-brand hover:underline">
                    {product.name}
                  </Link>
                  <span className="text-muted">{product.views} views</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No product views in this period yet.</p>
          )}
        </ReportSection>
      </div>

      <section className="rounded-3xl border border-border bg-lavender/20 p-6">
        <h2 className="font-display text-xl font-bold text-ink">Recommended Next Actions</h2>
        <ul className="mt-4 space-y-2">
          {report.recommendations.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-muted">
              <span className="text-brand">→</span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-3xl border border-border bg-white p-6">
        <h2 className="font-display text-lg font-bold text-ink">Export (Markdown)</h2>
        <p className="mt-1 text-sm text-muted">
          Copy for Slack, email, or Hermes review. Automated weekly cron saves to admin notifications.
        </p>
        <pre className="mt-4 max-h-96 overflow-auto rounded-2xl bg-ink/5 p-4 text-xs leading-relaxed text-ink">
          {markdown}
        </pre>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-brand">{value}</p>
    </div>
  );
}

function ReportSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="rounded-3xl border border-border bg-white p-6">
      <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
      <div className="mt-4 space-y-2">{children}</div>
    </article>
  );
}

function MetricRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}
