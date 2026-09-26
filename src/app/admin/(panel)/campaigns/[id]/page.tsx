import { notFound, redirect } from "next/navigation";
import { CampaignForm } from "@/components/admin/campaign-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const { id } = await params;

  const [campaign, segments, templates] = await Promise.all([
    db.campaign.findUnique({ where: { id } }),
    db.customerSegment.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.messageTemplate.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, channel: true } }),
  ]);

  if (!campaign) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">Edit Campaign</h1>
        <p className="text-muted">{campaign.name}</p>
      </div>
      <CampaignForm
        initial={{
          id: campaign.id,
          name: campaign.name,
          channel: campaign.channel,
          status: campaign.status,
          segmentId: campaign.segmentId,
          templateId: campaign.templateId,
          notes: campaign.notes,
          scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toISOString() : null,
        }}
        segments={segments}
        templates={templates}
      />
    </div>
  );
}
