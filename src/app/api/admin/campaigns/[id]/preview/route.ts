import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { db } from "@/lib/db";
import { resolveSegmentRecipients } from "@/lib/engagement/segment-resolver";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * F-212: read-only "how many people would this send reach" check, used by
 * campaign-status-select.tsx to show a recipient count before an admin
 * confirms moving a campaign to SENT. Mirrors dispatchCampaign's own
 * eligibility rule (a recipient only counts if they have the field the
 * campaign's channel actually sends to) so the number shown here matches
 * what the send will do.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  const { error } = await requireAdminPermission("engagement:manage");
  if (error) return error;

  const { id } = await params;
  const campaign = await db.campaign.findUnique({
    where: { id },
    include: { segment: true },
  });
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (!campaign.templateId) {
    return NextResponse.json({ ready: false, reason: "This campaign has no message template yet." });
  }
  if (!campaign.segmentId) {
    return NextResponse.json({ ready: false, reason: "This campaign has no audience segment yet." });
  }

  const recipients = await resolveSegmentRecipients(campaign.segmentId);
  const recipientCount = recipients.filter((recipient) =>
    campaign.channel === "EMAIL" ? Boolean(recipient.email) : Boolean(recipient.phone),
  ).length;

  return NextResponse.json({
    ready: true,
    recipientCount,
    channel: campaign.channel,
    segmentName: campaign.segment?.name ?? null,
  });
}
