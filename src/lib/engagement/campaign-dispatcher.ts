import { db } from "@/lib/db";
import { buildEngagementVars, renderTemplate } from "@/lib/engagement/template";
import {
  resolveSegmentRecipients,
  type SegmentRecipient,
} from "@/lib/engagement/segment-resolver";
import { sendEmail } from "@/lib/engagement/providers/email";
import { sendWhatsApp, sendWhatsAppTemplate } from "@/lib/engagement/providers/whatsapp";

export interface CampaignDispatchResult {
  campaignId: string;
  sent: number;
  failed: number;
  stub: number;
  skipped: number;
  total: number;
  errors: string[];
}

async function sendToRecipient(
  channel: "EMAIL" | "WHATSAPP",
  recipient: SegmentRecipient,
  subject: string | null,
  body: string,
): Promise<"sent" | "failed" | "stub" | "skipped"> {
  const vars = buildEngagementVars({
    email: recipient.email,
    phone: recipient.phone,
    firstName: recipient.firstName,
    contactName: recipient.contactName,
    organization: recipient.organization,
  });
  const renderedBody = renderTemplate(body, vars);
  const renderedSubject = subject ? renderTemplate(subject, vars) : "Message from DAAKYKA";

  if (channel === "EMAIL") {
    if (!recipient.email) return "skipped";
    const result = await sendEmail({
      to: recipient.email,
      subject: renderedSubject,
      html: `<p>${renderedBody.replace(/\n/g, "<br/>")}</p>`,
      text: renderedBody,
    });
    if (result.ok) return "sent";
    if (result.provider === "stub") return "stub";
    return "failed";
  }

  if (!recipient.phone) return "skipped";
  const useTemplate = process.env.WATI_USE_TEMPLATES === "true";
  const result = useTemplate
    ? await sendWhatsAppTemplate({
        phone: recipient.phone,
        message: renderedBody,
        parameters: [vars.first_name ?? "there", vars.organization ?? "your team"],
      })
    : await sendWhatsApp({ phone: recipient.phone, message: renderedBody });

  if (result.ok) return "sent";
  if (result.provider === "stub") return "stub";
  return "failed";
}

export async function dispatchCampaign(campaignId: string): Promise<CampaignDispatchResult> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: { template: true, segment: true },
  });

  if (!campaign) {
    throw new Error(`Campaign not found: ${campaignId}`);
  }

  if (!campaign.template) {
    throw new Error("Campaign requires a message template before sending");
  }

  if (!campaign.segmentId) {
    throw new Error("Campaign requires an audience segment before sending");
  }

  const recipients = await resolveSegmentRecipients(campaign.segmentId);
  const result: CampaignDispatchResult = {
    campaignId,
    sent: 0,
    failed: 0,
    stub: 0,
    skipped: 0,
    total: recipients.length,
    errors: [],
  };

  for (const recipient of recipients) {
    const status = await sendToRecipient(
      campaign.channel,
      recipient,
      campaign.template.subject,
      campaign.template.body,
    );

    if (status === "sent") result.sent += 1;
    else if (status === "failed") {
      result.failed += 1;
      result.errors.push(recipient.email ?? recipient.phone ?? "unknown recipient");
    } else if (status === "stub") result.stub += 1;
    else result.skipped += 1;
  }

  await db.adminNotification.create({
    data: {
      title: `Campaign sent: ${campaign.name}`,
      body: `${result.sent} delivered, ${result.stub} stub, ${result.failed} failed, ${result.skipped} skipped (${result.total} recipients).`,
      type: "campaign_dispatch",
      metadata: JSON.stringify(result),
    },
  });

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "SENT", updatedAt: new Date() },
  });

  return result;
}

export async function processDueScheduledCampaigns(): Promise<{
  processed: number;
  results: CampaignDispatchResult[];
}> {
  const due = await db.campaign.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: new Date() },
    },
    take: 10,
  });

  const results: CampaignDispatchResult[] = [];
  for (const campaign of due) {
    try {
      results.push(await dispatchCampaign(campaign.id));
    } catch (error) {
      await db.adminNotification.create({
        data: {
          title: `Campaign failed: ${campaign.name}`,
          body: error instanceof Error ? error.message : "Dispatch failed",
          type: "campaign_dispatch_error",
          metadata: JSON.stringify({ campaignId: campaign.id }),
        },
      });
    }
  }

  return { processed: results.length, results };
}
