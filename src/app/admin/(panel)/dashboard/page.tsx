import { db } from "@/lib/db";
import Link from "next/link";
import { countDraftProductsAwaitingPublish, countLowStockVariants } from "@/lib/catalog/products";
import { getUndeliveredEmailCount } from "@/lib/engagement/outbox";
import { getDashboardWidgetVisibility } from "@/lib/dashboard/widget-visibility";
import { getSubscriberCounts } from "@/lib/dashboard/subscriber-metrics";
import { getOrdersTodayStats } from "@/lib/orders/dashboard-metrics";
import { getPendingReviewCount } from "@/lib/reviews/pending-count";
import { formatDateTimeIST } from "@/lib/format/datetime";
import { requireAdminPage } from "@/lib/auth/require-admin-page";

export default async function AdminDashboardPage() {
  // F-062: the dashboard had no session check of its own — it relied
  // entirely on the (panel) layout, which does not re-run on a
  // client-side (RSC) navigation, so a deactivated/demoted admin with a
  // tab already open could keep reaching fresh dashboard data. Every
  // role has "dashboard:view", so this call is really the revocation
  // check; see src/lib/auth/require-admin-page.ts.
  const session = await requireAdminPage("dashboard:view");

  // F-161: which widgets `session.role` may see — mirrors the permission
  // each linked page itself checks, so a widget only shows when
  // following it actually works. See src/lib/dashboard/widget-visibility.ts.
  const visibility = getDashboardWidgetVisibility(session.role);
  // F-268/F-049: the undelivered-email banner links to /admin/notifications
  // — only show it to a role that can actually see something there.
  const canSeeUndeliveredEmailBanner = visibility.leads || visibility.orders;

  const [
    leadCount,
    newLeads,
    blogCount,
    subscriberCounts,
    pendingCampaigns,
    pendingHermes,
    draftProducts,
    lowStockVariants,
    ordersToday,
    pendingReviews,
    recentLeads,
    recentLogs,
    undeliveredEmail,
  ] = await Promise.all([
    // F-161: each query below is skipped entirely (not just hidden in
    // the JSX) when the role can't see the widget it feeds, so a
    // CONTENT_EDITOR or VIEWER dashboard load no longer does the DB work
    // for data it will never render.
    visibility.leads ? db.bulkOrderLead.count() : Promise.resolve(0),
    visibility.leads ? db.bulkOrderLead.count({ where: { status: "NEW" } }) : Promise.resolve(0),
    visibility.blog ? db.blogPostRecord.count({ where: { status: "PUBLISHED" } }) : Promise.resolve(0),
    // F-153: real, confirmed-subscriber counts instead of a bare
    // unfiltered count() that included unconfirmed/unsubscribed rows.
    visibility.subscribers ? getSubscriberCounts() : Promise.resolve({ active: 0, pending: 0 }),
    visibility.campaigns ? db.campaign.count({ where: { status: "PENDING_APPROVAL" } }) : Promise.resolve(0),
    visibility.hermes ? db.hermesApproval.count({ where: { status: "PENDING" } }) : Promise.resolve(0),
    visibility.products ? countDraftProductsAwaitingPublish() : Promise.resolve(0),
    visibility.products ? countLowStockVariants() : Promise.resolve(0),
    // F-059/F-060: confirmed-only orders/revenue, IST midnight boundary.
    visibility.orders
      ? getOrdersTodayStats()
      : Promise.resolve({ count: 0, revenue: 0, pendingPaymentCount: 0 }),
    // F-297: nothing previously told the owner a review was pending.
    visibility.reviews ? getPendingReviewCount() : Promise.resolve(0),
    visibility.leads
      ? db.bulkOrderLead.findMany({ orderBy: { createdAt: "desc" }, take: 5 })
      : Promise.resolve([]),
    visibility.audit
      ? db.auditLog.findMany({
          orderBy: { createdAt: "desc" },
          take: 8,
          include: { user: { select: { name: true, email: true } } },
        })
      : Promise.resolve([]),
    // F7 fix: undelivered transactional email (EmailOutbox PENDING/FAILED)
    // — see src/lib/engagement/outbox.ts. getUndeliveredEmailCount() never
    // throws, so a hiccup here can't break the rest of the dashboard.
    canSeeUndeliveredEmailBanner ? getUndeliveredEmailCount() : Promise.resolve({ total: 0, failed: 0 }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Dashboard</h1>
        <p className="text-muted">Overview of storefront content and bulk enquiries.</p>
      </div>

      {canSeeUndeliveredEmailBanner && undeliveredEmail.total > 0 && (
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
        {visibility.leads && (
          <StatCard label="Bulk Enquiries" value={String(leadCount)} hint={`${newLeads} new`} />
        )}
        {visibility.subscribers && (
          <Link href="/admin/engagement/subscribers">
            <StatCard
              label="Newsletter Subscribers"
              value={String(subscriberCounts.active)}
              hint={subscriberCounts.pending > 0 ? `${subscriberCounts.pending} awaiting confirmation` : "Confirmed, active"}
            />
          </Link>
        )}
        {visibility.blog && (
          <StatCard label="Published Articles" value={String(blogCount)} hint="Journal posts live" />
        )}
        {visibility.campaigns && (
          <StatCard label="Campaigns Pending" value={String(pendingCampaigns)} hint="Awaiting approval" />
        )}
        {visibility.hermes && (
          <StatCard label="Hermes Pending" value={String(pendingHermes)} hint="Recommendations queue" />
        )}
      </div>

      {(visibility.products || visibility.orders || visibility.reviews) && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {visibility.products && (
            <Link href="/admin/products?status=DRAFT">
              <StatCard label="Draft Products" value={String(draftProducts)} hint="Awaiting publish" />
            </Link>
          )}
          {visibility.products && (
            <Link href="/admin/products?stockFilter=low">
              <StatCard label="Low-Stock Variants" value={String(lowStockVariants)} hint="Active variants under 10 in stock" />
            </Link>
          )}
          {visibility.orders && (
            <Link href="/admin/orders">
              <StatCard
                label="Orders Today"
                value={String(ordersToday.count)}
                hint={`₹${ordersToday.revenue.toLocaleString("en-IN", { maximumFractionDigits: 0 })} confirmed today${
                  ordersToday.pendingPaymentCount > 0 ? ` · ${ordersToday.pendingPaymentCount} awaiting payment` : ""
                }`}
              />
            </Link>
          )}
          {visibility.reviews && (
            <Link href="/admin/reviews">
              <StatCard label="Reviews Pending" value={String(pendingReviews)} hint="Awaiting moderation" />
            </Link>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-border bg-lavender/20 p-4">
        <Link href="/admin/reports" className="text-sm font-semibold text-brand hover:underline">
          View Weekly Growth Report →
        </Link>
      </div>

      {(visibility.leads || visibility.audit) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {visibility.leads && (
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
          )}

          {visibility.audit && (
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
                    {/* F-060: server-rendered in the process timezone
                        previously — UTC on Vercel, 5.5h behind IST — now
                        pinned to IST explicitly. */}
                    <p className="text-muted">
                      {log.user?.name ?? "System"} · {formatDateTimeIST(log.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
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
