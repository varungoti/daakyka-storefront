import { CampaignStatusSelect } from "@/components/admin/campaign-status-select";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { getSubscriberCounts } from "@/lib/dashboard/subscriber-metrics";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function EngagementPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const [subscriberCounts, segments, templates, campaigns] = await Promise.all([
    // F-153/F-270: this used to be a bare, unfiltered
    // db.newsletterSubscriber.count(), which included every double-opt-in
    // row that never confirmed and anyone who unsubscribed — the same fix
    // already applied to the dashboard tile (src/lib/dashboard/subscriber-metrics.ts).
    getSubscriberCounts(),
    db.customerSegment.count(),
    db.messageTemplate.count(),
    db.campaign.findMany({
      orderBy: { updatedAt: "desc" },
      take: 5,
      include: { segment: true, template: true },
    }),
  ]);

  const pendingCampaigns = await db.campaign.count({
    where: { status: "PENDING_APPROVAL" },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Engagement Hub</h1>
        <p className="text-muted">Customer segments, message templates, and campaign workflows.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Link href="/admin/engagement/subscribers" className="block rounded-2xl transition hover:opacity-90">
          <StatCard
            label="Newsletter Subscribers"
            value={String(subscriberCounts.active)}
            hint={
              subscriberCounts.pending > 0
                ? `${subscriberCounts.pending} awaiting confirmation`
                : "Confirmed, active"
            }
          />
        </Link>
        <StatCard label="Customer Segments" value={String(segments)} />
        <StatCard label="Message Templates" value={String(templates)} />
        <StatCard label="Pending Approval" value={String(pendingCampaigns)} hint="Campaigns awaiting review" />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <QuickLink href="/admin/segments" title="Customer Segments" desc="Define audience groups for campaigns" />
        <QuickLink href="/admin/templates" title="Message Templates" desc="Email and WhatsApp template library" />
        <QuickLink href="/admin/campaigns" title="Campaign Planner" desc="Draft and approve outreach campaigns" />
        <QuickLink href="/admin/journeys" title="Customer Journeys" desc="Welcome, bulk, and post-purchase flows" />
        <QuickLink href="/admin/intelligence" title="Product Intelligence" desc="Best sellers, bundles, SEO gaps" />
        <QuickLink href="/admin/hermes" title="Hermes Agent" desc="AI recommendations with approval queue" />
      </div>

      <section className="rounded-3xl border border-border bg-surface p-6">
        <h2 className="font-display text-xl font-bold text-ink">Recent Campaigns</h2>
        <ul className="mt-4 space-y-3">
          {campaigns.map((campaign) => (
            <li key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
              <div>
                <p className="font-semibold text-ink">{campaign.name}</p>
                <p className="text-sm text-muted">
                  {campaign.channel} · {campaign.segment?.name ?? "No segment"} ·{" "}
                  {campaign.template?.name ?? "No template"}
                </p>
              </div>
              <CampaignStatusSelect campaignId={campaign.id} currentStatus={campaign.status} />
            </li>
          ))}
          {campaigns.length === 0 && <p className="text-sm text-muted">No campaigns yet.</p>}
        </ul>
      </section>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-brand">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function QuickLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-border bg-surface p-5 transition hover:border-brand/40 hover:shadow-sm">
      <p className="font-display font-bold text-ink">{title}</p>
      <p className="mt-2 text-sm text-muted">{desc}</p>
    </Link>
  );
}
