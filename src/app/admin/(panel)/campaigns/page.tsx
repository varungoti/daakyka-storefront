import { CampaignStatusSelect } from "@/components/admin/campaign-status-select";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";

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
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Campaign Planner</h1>
        <p className="text-muted">
          Draft campaigns require approval before send — no messages are dispatched automatically yet.
        </p>
      </div>

      <div className="overflow-x-auto rounded-3xl border border-border bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border bg-lavender/30 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3">Campaign</th>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Segment</th>
              <th className="px-4 py-3">Template</th>
              <th className="px-4 py-3">Status</th>
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
                  <CampaignStatusSelect campaignId={campaign.id} currentStatus={campaign.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
