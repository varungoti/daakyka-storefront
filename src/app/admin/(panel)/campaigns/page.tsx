import { CampaignStatusSelect } from "@/components/admin/campaign-status-select";
import { DeleteButton } from "@/components/admin/delete-button";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Campaigns" };

// F-217: mirrors campaigns/[id]/route.ts's DELETE guard — a campaign
// that's sending or already sent is a record of what went out, not
// something to delete from the list.
const UNDELETABLE_STATUSES = new Set(["SENDING", "SENT"]);

export default async function CampaignsPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const campaigns = await db.campaign.findMany({
    orderBy: { updatedAt: "desc" },
    include: { segment: true, template: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-ink">Campaign Planner</h1>
          <p className="text-muted">
            {/* F-212: this used to claim nothing sends automatically, but
                picking SENT here dispatches immediately, and the daily cron
                sends anything SCHEDULED. */}
            Draft campaigns require approval before they can send. Picking SENT below dispatches to the
            segment right away — you&apos;ll be asked to confirm the recipient count first. Scheduled
            campaigns send automatically at their scheduled time.
          </p>
        </div>
        <Link
          href="/admin/campaigns/new"
          className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand/90"
        >
          New Campaign
        </Link>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-border bg-surface">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Segment</th>
              <th className="px-4 py-3">Template</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id} className="border-b border-border/70 align-top">
                <td className="px-4 py-4 font-semibold text-ink">{campaign.name}</td>
                <td className="px-4 py-4">{campaign.channel}</td>
                <td className="px-4 py-4 text-muted">{campaign.segment?.name ?? "—"}</td>
                <td className="px-4 py-4 text-muted">{campaign.template?.name ?? "—"}</td>
                <td className="px-4 py-4">
                  <CampaignStatusSelect campaignId={campaign.id} campaignName={campaign.name} currentStatus={campaign.status} />
                </td>
                <td className="px-4 py-4">
                  <div className="flex gap-2">
                    <Link
                      href={`/admin/campaigns/${campaign.id}`}
                      className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-ink hover:bg-lilac/40"
                    >
                      Edit
                    </Link>
                    {!UNDELETABLE_STATUSES.has(campaign.status) && (
                      <DeleteButton
                        href={`/api/admin/campaigns/${campaign.id}`}
                        confirmMessage={`Delete the "${campaign.name}" campaign?`}
                      />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  No campaigns yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
