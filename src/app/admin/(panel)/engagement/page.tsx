import { CampaignStatusSelect } from "@/components/admin/campaign-status-select";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function EngagementPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const [subscribers, segments, templates, campaigns] = await Promise.all([
    db.newsletterSubscriber.count(),
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
        <StatCard label="Newsletter Subscribers" value={String(subscribers)} />
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

      <section className="rounded-3xl border border-border bg-white p-6">
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
    <div className="rounded-2xl border border-border bg-white p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-bold text-brand">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function QuickLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="rounded-2xl border border-border bg-white p-5 transition hover:border-brand/40 hover:shadow-sm">
      <p className="font-display font-bold text-ink">{title}</p>
      <p className="mt-2 text-sm text-muted">{desc}</p>
    </Link>
  );
}
