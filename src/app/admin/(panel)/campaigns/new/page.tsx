import { redirect } from "next/navigation";
import { CampaignForm } from "@/components/admin/campaign-form";
import { hasPermission } from "@/lib/auth/rbac";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";

export default async function NewCampaignPage() {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "engagement:manage")) {
    redirect("/admin/dashboard");
  }

  const [segments, templates] = await Promise.all([
    db.customerSegment.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.messageTemplate.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, channel: true } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-ink">New Campaign</h1>
        <p className="text-muted">Draft an email or WhatsApp campaign for one of your audience segments.</p>
      </div>
      <CampaignForm segments={segments} templates={templates} />
    </div>
  );
}
