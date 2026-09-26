import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { isIntegrationEnabled } from "@/lib/integrations/enabled";
import { autoLinkUrls, buildEngagementVars, renderTemplate } from "@/lib/engagement/template";
import {
  resolveSegmentRecipients,
  type SegmentRecipient,
} from "@/lib/engagement/segment-resolver";
import { sendMarketingEmail } from "@/lib/engagement/send-marketing-email";
import { sendWhatsApp, sendWhatsAppTemplate } from "@/lib/engagement/providers/whatsapp";
import { hasWhatsAppMarketingConsent } from "@/lib/engagement/whatsapp-consent";

export interface CampaignDispatchResult {
  campaignId: string;
  sent: number;
  failed: number;
  stub: number;
  skipped: number;
  total: number;
  errors: string[];
}

/** F-265 fix: thrown by dispatchCampaign's provider preflight — kept as a
 * distinct type so processDueScheduledCampaigns (below) can tell "the
 * provider just isn't configured yet" apart from a genuine dispatch error
 * and avoid raising a fresh AdminNotification on every cron tick for the
 * same still-unconfigured campaign. */
export class ProviderNotConfiguredError extends Error {}

const CLAIMABLE_STATUSES = ["SCHEDULED", "APPROVED"] as const;
type DeliveryStatus = "sent" | "failed" | "stub" | "skipped";

async function sendToRecipient(
  channel: "EMAIL" | "WHATSAPP",
  recipient: SegmentRecipient,
  subject: string | null,
  body: string,
): Promise<{ status: DeliveryStatus; error?: string }> {
  const vars = buildEngagementVars({
    email: recipient.email,
    phone: recipient.phone,
    firstName: recipient.firstName,
    contactName: recipient.contactName,
    organization: recipient.organization,
  });

  if (channel === "EMAIL") {
    if (!recipient.email) return { status: "skipped" };
    // engagement_compliance: HTML-escape substituted values for the HTML
    // body (a customer-controlled name/organization can't inject markup);
    // the plain-text part and subject are never rendered as HTML so they
    // stay unescaped.
    const renderedBodyHtml = renderTemplate(body, vars, { escapeHtml: true });
    const renderedBodyText = renderTemplate(body, vars);
    const renderedSubject = subject ? renderTemplate(subject, vars) : "Message from DAAKYKA";
    // F-270 fix: a bare URL in the source template rendered as plain text
    // inside the single wrapping <p> — auto-link it into a real <a> tag.
    const linkedBodyHtml = autoLinkUrls(renderedBodyHtml);
    const result = await sendMarketingEmail({
      to: recipient.email,
      subject: renderedSubject,
      html: `<p>${linkedBodyHtml.replace(/\n/g, "<br/>")}</p>`,
      text: renderedBodyText,
    });
    if (result.ok) return { status: "sent" };
    if (result.provider === "skipped") return { status: "skipped", error: result.error };
    if (result.provider === "stub") return { status: "stub", error: result.error };
    return { status: "failed", error: result.error };
  }

  if (!recipient.phone) return { status: "skipped" };

  // F-317 fix: a WhatsApp campaign is always business-initiated marketing —
  // it may only reach a phone with an explicit, un-opted-out WhatsAppOptIn
  // row (see whatsapp-consent.ts and the schema comment on that model).
  if (!(await hasWhatsAppMarketingConsent(recipient.phone))) {
    return { status: "skipped", error: "no_whatsapp_opt_in" };
  }

  const renderedBody = renderTemplate(body, vars);
  const useTemplate = process.env.WATI_USE_TEMPLATES === "true";
  const result = useTemplate
    ? await sendWhatsAppTemplate({
        phone: recipient.phone,
        message: renderedBody,
        parameters: [vars.first_name ?? "there", vars.organization ?? "your team"],
      })
    : await sendWhatsApp({ phone: recipient.phone, message: renderedBody });

  if (result.ok) return { status: "sent" };
  if (result.provider === "stub") return { status: "stub", error: result.error };
  return { status: "failed", error: result.error };
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

const RETRYABLE_DELIVERY_STATUSES = ["stub", "failed"] as const;

/**
 * F-227/F-265 fix: atomically claims a single recipient for THIS dispatch
 * run before anything is sent, replacing the old "snapshot every existing
 * CampaignDelivery row once at the top of the run, then create() after
 * sending" approach. That let a resumed run (the cron picking up a campaign
 * still SENDING because an earlier run was interrupted) send to every
 * recipient the snapshot didn't already know about — including one the
 * *other*, still-in-flight run was sending to at that exact moment — and
 * separately meant a `stub`/`failed` row could never be retried, because
 * the snapshot counted it as "already attempted".
 *
 * The (campaignId, recipient, channel) unique constraint is what makes this
 * atomic: creating a fresh row with status "sending" either succeeds (no
 * row existed — this run owns it) or hits P2002, at which point only a
 * `stub`/`failed` row is eligible to be reclaimed, and only via a
 * conditional `updateMany` guarded on that row's own current status — so
 * two runs racing the same stub/failed row can't both win the reclaim.
 * Returns null when the recipient is already sent/skipped (truly done) or
 * is "sending" right now under another run/claim.
 *
 * Exported (like claimCampaignForSending above) so this specific atomicity
 * guarantee — new claim / retry-a-stub-or-failed-row / refuse-an-already-
 * done-or-in-flight-row — can be tested directly against the DB without
 * needing a configured email/WhatsApp provider.
 */
export async function claimRecipientForSending(
  campaignId: string,
  recipient: string,
  channel: "EMAIL" | "WHATSAPP",
): Promise<string | null> {
  try {
    const row = await db.campaignDelivery.create({
      data: { campaignId, recipient, channel, status: "sending" },
    });
    return row.id;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      throw error;
    }
  }

  const existing = await db.campaignDelivery.findUnique({
    where: { campaignId_recipient_channel: { campaignId, recipient, channel } },
  });
  if (!existing || !(RETRYABLE_DELIVERY_STATUSES as readonly string[]).includes(existing.status)) {
    return null;
  }

  const reclaimed = await db.campaignDelivery.updateMany({
    where: { id: existing.id, status: existing.status },
    data: { status: "sending" },
  });
  return reclaimed.count === 1 ? existing.id : null;
}

// F-279/F-337 fix: dispatchCampaign used to loop over every recipient with
// no time budget at all — fine for a small list, but a large one (see
// F-279's reproduction: ~1s/recipient once real network latency is
// involved) got killed mid-loop by the platform's own function timeout,
// leaving the campaign stuck SENDING with no clean resume point and one
// recipient possibly double-attempted. Stopping cleanly with time to spare
// leaves every recipient not yet reached simply un-attempted (no
// CampaignDelivery row at all), which is exactly what lets the next cron
// tick's resume pick up right where this run left off.
const DISPATCH_TIME_BUDGET_MS = 240_000;

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

  // F-337 fix: no longer capped (see segment-resolver.ts) — this is now the
  // real, complete eligible audience, so `recipients.length` is a true "M"
  // for a "N of M" report, not a silently-truncated one. Resolved before
  // the provider preflight below and before claiming anything: an empty
  // audience (F-212) is a real, permanent outcome regardless of provider
  // configuration, and must still be reported FAILED rather than left
  // unclaimed forever waiting on a provider that wouldn't have mattered.
  const recipients = await resolveSegmentRecipients(campaign.segmentId);

  // F-265 fix: check the provider is actually usable BEFORE claiming (or
  // resuming) anything — but only when there's actually someone to send to;
  // see the F-212 comment above. Sending with the provider off used to just
  // mark every recipient "stub" and the whole campaign FAILED with no
  // signal to the admin about why — and, combined with the old
  // alreadyAttempted snapshot counting stub rows as done, there was then no
  // way to retry it once the provider was actually configured.
  if (recipients.length > 0) {
    const providerReady = await isIntegrationEnabled(campaign.channel === "EMAIL" ? "BREVO" : "WATI");
    if (!providerReady) {
      throw new ProviderNotConfiguredError(
        campaign.channel === "EMAIL"
          ? "Email provider (Brevo) is not enabled — set it up under Integrations before sending"
          : "WhatsApp provider (WATI) is not enabled — set it up under Integrations before sending",
      );
    }
  }

  // engagement_compliance: claim-then-send idempotency. A campaign already
  // in SENDING is a resumed run (a previous dispatch was interrupted before
  // finishing every recipient) — proceed straight to sending; the
  // per-recipient claim in the loop below is what actually keeps a resume
  // from double-sending. Anything else must go through the atomic
  // campaign-level claim first.
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

  const result: CampaignDispatchResult = {
    campaignId,
    sent: 0,
    failed: 0,
    stub: 0,
    skipped: 0,
    total: recipients.length,
    errors: [],
  };

  const dispatchStart = Date.now();
  let timedOut = false;

  for (const recipient of recipients) {
    if (Date.now() - dispatchStart >= DISPATCH_TIME_BUDGET_MS) {
      timedOut = true;
      break;
    }

    const recipientKey = campaign.channel === "EMAIL" ? recipient.email : recipient.phone;
    if (!recipientKey) {
      result.skipped += 1;
      continue;
    }

    const deliveryId = await claimRecipientForSending(campaignId, recipientKey, campaign.channel);
    if (!deliveryId) {
      // Already sent/skipped (truly done), or "sending" under a
      // concurrently-running claim right now — either way, this run must
      // not send to them again.
      result.skipped += 1;
      continue;
    }

    const { status, error } = await sendToRecipient(
      campaign.channel,
      recipient,
      campaign.template.subject,
      campaign.template.body,
    );

    await db.campaignDelivery.update({
      where: { id: deliveryId },
      data: {
        status,
        sentAt: status === "sent" ? new Date() : null,
        error: status === "failed" ? (error ?? "Send failed") : error ?? null,
      },
    });

    if (status === "sent") result.sent += 1;
    else if (status === "failed") {
      result.failed += 1;
      result.errors.push(recipientKey);
    } else if (status === "stub") result.stub += 1;
    else result.skipped += 1;
  }

  if (timedOut) {
    // F-279/F-337 fix: more recipients remain than fit in this run's time
    // budget. Leave the campaign status exactly as SENDING (untouched) so
    // processDueScheduledCampaigns' own `{ status: "SENDING" }` resume
    // clause picks it back up on the very next cron tick, continuing from
    // whichever recipients still have no (or a stub/failed) delivery row —
    // no notification, no status flip, just "not finished yet".
    return result;
  }

  // Every recipient in `recipients` now has a terminal (sent/failed/stub/
  // skipped) CampaignDelivery row — safe to compute the campaign's real
  // final outcome from the full, cumulative set (spans every run this
  // campaign ever took, not just this one) rather than only this run's
  // counts.
  const allDeliveries = await db.campaignDelivery.findMany({
    where: { campaignId },
    select: { status: true },
  });
  const cumulative = { sent: 0, stub: 0, failed: 0, skipped: 0 };
  for (const delivery of allDeliveries) {
    if (delivery.status === "sent") cumulative.sent += 1;
    else if (delivery.status === "stub") cumulative.stub += 1;
    else if (delivery.status === "failed") cumulative.failed += 1;
    else cumulative.skipped += 1;
  }
  // F-212: a run that delivered to nobody — an empty segment, or every
  // recipient lacking the channel's contact field — used to be marked
  // SENT anyway (`allDeliveries.length === 0` counted as success). That
  // hid the problem: the admin UI and the AdminNotification both reported
  // it as a normal completed send. Report it as FAILED instead so it's
  // visible and, for a SCHEDULED campaign, the cron's `status: SCHEDULED`
  // filter stops re-selecting it once the true final status lands here.
  const finalStatus = cumulative.sent > 0 ? "SENT" : "FAILED";

  await db.adminNotification.create({
    data: {
      title: `Campaign ${finalStatus === "SENT" ? "sent" : "failed"}: ${campaign.name}`,
      // F-337 fix: "N of M" now uses the true eligible-audience count
      // (recipients.length, no longer capped) rather than only this run's
      // slice of it.
      body: `${cumulative.sent} of ${recipients.length} delivered (${cumulative.stub} stub, ${cumulative.failed} failed, ${cumulative.skipped} skipped).`,
      type: "campaign_dispatch",
      metadata: JSON.stringify({ ...result, cumulative }),
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
      // F-265 fix: the provider being off is a standing condition, not a
      // one-off dispatch failure — every cron tick would otherwise raise a
      // fresh "Campaign failed" AdminNotification for the same campaign
      // until an admin configures the provider. Leave the campaign in its
      // current (unclaimed, or still-SENDING) status so the next tick just
      // quietly retries once it's configured.
      if (error instanceof ProviderNotConfiguredError) continue;

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
