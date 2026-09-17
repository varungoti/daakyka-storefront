import { db } from "@/lib/db";
import { buildEngagementVars, renderTemplate } from "@/lib/engagement/template";
import {
  resolveSegmentRecipients,
  type SegmentRecipient,
} from "@/lib/engagement/segment-resolver";
import { sendMarketingEmail } from "@/lib/engagement/send-marketing-email";
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

const CLAIMABLE_STATUSES = ["SCHEDULED", "APPROVED"] as const;

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

  if (channel === "EMAIL") {
    if (!recipient.email) return "skipped";
    // engagement_compliance: HTML-escape substituted values for the HTML
    // body (a customer-controlled name/organization can't inject markup);
    // the plain-text part and subject are never rendered as HTML so they
    // stay unescaped.
    const renderedBodyHtml = renderTemplate(body, vars, { escapeHtml: true });
    const renderedBodyText = renderTemplate(body, vars);
    const renderedSubject = subject ? renderTemplate(subject, vars) : "Message from DAAKYKA";
    const result = await sendMarketingEmail({
      to: recipient.email,
      subject: renderedSubject,
      html: `<p>${renderedBodyHtml.replace(/\n/g, "<br/>")}</p>`,
      text: renderedBodyText,
    });
    if (result.ok) return "sent";
    if (result.provider === "skipped") return "skipped";
    if (result.provider === "stub") return "stub";
    return "failed";
  }

  if (!recipient.phone) return "skipped";
  const renderedBody = renderTemplate(body, vars);
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

/**
 * Atomically transitions a campaign from SCHEDULED/APPROVED to SENDING.
 * `count === 1` means THIS call won the race and should proceed with the
 * send; `count === 0` means either the campaign isn't in a claimable state
 * or another dispatch run (an overlapping cron tick, a concurrent admin
 * "send now") already claimed it a moment earlier — either way, the caller
 * must not send.
 *
 * Exported standalone (not just inlined in dispatchCampaign) so it can be
 * exercised directly in tests: calling it twice in a row for the same
 * campaign id is the whole idempotency guarantee — the second call must be
 * a no-op.
 */
export async function claimCampaignForSending(campaignId: string): Promise<boolean> {
  const result = await db.campaign.updateMany({
    where: { id: campaignId, status: { in: [...CLAIMABLE_STATUSES] } },
    data: { status: "SENDING" },
  });
  return result.count === 1;
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

  // engagement_compliance: claim-then-send idempotency. A campaign already
  // in SENDING is a resumed run (a previous dispatch was interrupted before
  // finishing every recipient) — proceed straight to sending, relying on
  // the CampaignDelivery unique constraint + the "already has a delivery
  // row" skip below to avoid re-sending to anyone already attempted.
  // Anything else must go through the atomic claim first.
  const resuming = campaign.status === "SENDING";
  if (!resuming) {
    if (!(CLAIMABLE_STATUSES as readonly string[]).includes(campaign.status)) {
      throw new Error(`Campaign cannot be sent from status ${campaign.status}`);
    }
    const claimed = await claimCampaignForSending(campaignId);
    if (!claimed) {
      throw new Error("Campaign is already being sent by another process");
    }
  }

  const recipients = await resolveSegmentRecipients(campaign.segmentId);

  // Resume-safe: recipients already recorded (by this run or an earlier,
  // interrupted one) are skipped rather than re-sent to.
  const existingDeliveries = await db.campaignDelivery.findMany({
    where: { campaignId },
    select: { recipient: true },
  });
  const alreadyAttempted = new Set(existingDeliveries.map((d) => d.recipient));

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
    const recipientKey = campaign.channel === "EMAIL" ? recipient.email : recipient.phone;
    if (!recipientKey) {
      result.skipped += 1;
      continue;
    }

    if (alreadyAttempted.has(recipientKey)) {
      result.skipped += 1;
      continue;
    }

    const status = await sendToRecipient(
      campaign.channel,
      recipient,
      campaign.template.subject,
      campaign.template.body,
    );

    try {
      await db.campaignDelivery.create({
        data: {
          campaignId,
          recipient: recipientKey,
          channel: campaign.channel,
          status,
          sentAt: status === "sent" ? new Date() : null,
          error: status === "failed" ? "Send failed" : null,
        },
      });
    } catch {
      // Unique constraint on (campaignId, recipient, channel): a
      // concurrent run already recorded this recipient a moment earlier.
      // The send just happened twice in that narrow window (acceptable —
      // rare, and no worse than the pre-idempotency behavior), but we
      // don't want to also double-count it in `result` below beyond what
      // already happened, so just leave the counts as sent by THIS run.
    }

    if (status === "sent") result.sent += 1;
    else if (status === "failed") {
      result.failed += 1;
      result.errors.push(recipientKey);
    } else if (status === "stub") result.stub += 1;
    else result.skipped += 1;
  }

  const allDeliveries = await db.campaignDelivery.findMany({
    where: { campaignId },
    select: { status: true },
  });
  const everSent = allDeliveries.some((d) => d.status === "sent");
  const finalStatus = allDeliveries.length === 0 || everSent ? "SENT" : "FAILED";

  await db.adminNotification.create({
    data: {
      title: `Campaign ${finalStatus === "SENT" ? "sent" : "failed"}: ${campaign.name}`,
      body: `${result.sent} delivered, ${result.stub} stub, ${result.failed} failed, ${result.skipped} skipped (${result.total} recipients this run).`,
      type: "campaign_dispatch",
      metadata: JSON.stringify(result),
    },
  });

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: finalStatus, updatedAt: new Date() },
  });

  return result;
}

export async function processDueScheduledCampaigns(): Promise<{
  processed: number;
  results: CampaignDispatchResult[];
}> {
  const due = await db.campaign.findMany({
    where: {
      OR: [
        { status: "SCHEDULED", scheduledAt: { lte: new Date() } },
        // Resume campaigns stuck mid-send from an interrupted previous run.
        { status: "SENDING" },
      ],
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
