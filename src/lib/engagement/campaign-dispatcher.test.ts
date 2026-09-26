import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import {
  claimRecipientForSending,
  dispatchCampaign,
  processDueScheduledCampaigns,
  ProviderNotConfiguredError,
} from "@/lib/engagement/campaign-dispatcher";

/**
 * Release-hardening batch 3a (engagement-journeys-campaigns-reliability):
 * F-227 (a resumed campaign run must claim a recipient before sending, not
 * after), F-265 (a stub/failed delivery must be retryable, and the provider
 * being off must not be reported as a fresh failure on every cron tick).
 *
 * Neither Brevo nor WATI is configured in this test environment (by design
 * — see the task's SAFETY constraints), so dispatchCampaign's own send path
 * always hits its provider preflight first. That's exercised directly
 * below. The per-recipient claim atomicity (the actual F-227/F-265 fix) is
 * tested by calling claimRecipientForSending directly against the DB,
 * which needs no provider at all.
 */

async function createCampaign(channel: "EMAIL" | "WHATSAPP", status: "APPROVED" | "SCHEDULED" | "SENDING") {
  const suffix = randomUUID();
  return db.campaign.create({
    data: {
      name: `Test campaign ${suffix}`,
      channel,
      status,
    },
  });
}

describe("campaign-dispatcher (release-hardening batch 3a)", () => {
  const createdCampaignIds: string[] = [];

  after(async () => {
    if (createdCampaignIds.length > 0) {
      await db.campaignDelivery.deleteMany({ where: { campaignId: { in: createdCampaignIds } } }).catch(() => {});
      await db.campaign.deleteMany({ where: { id: { in: createdCampaignIds } } }).catch(() => {});
    }
  });

  describe("claimRecipientForSending (F-227/F-265)", () => {
    it("claims a fresh recipient, refuses a second claim while it's still 'sending', and never re-claims a 'sent' one", async () => {
      const campaign = await createCampaign("EMAIL", "SENDING");
      createdCampaignIds.push(campaign.id);
      const recipient = `claim-fresh-${randomUUID()}@example.com`;

      const firstClaim = await claimRecipientForSending(campaign.id, recipient, "EMAIL");
      assert.ok(firstClaim, "expected the first claim on a never-attempted recipient to succeed");

      // F-227 fix under test: a second, concurrent/resumed run must not be
      // able to claim (and therefore send to) the same recipient again
      // while the first claim is still in flight ("sending").
      const raceClaim = await claimRecipientForSending(campaign.id, recipient, "EMAIL");
      assert.equal(raceClaim, null, "a recipient already claimed as 'sending' must not be claimable again");

      // Simulate the first claim's send completing successfully.
      await db.campaignDelivery.update({ where: { id: firstClaim! }, data: { status: "sent", sentAt: new Date() } });

      // A recipient that is genuinely done (sent) must never be re-claimed,
      // however many more times dispatchCampaign resumes/retries.
      const postSentClaim = await claimRecipientForSending(campaign.id, recipient, "EMAIL");
      assert.equal(postSentClaim, null, "a 'sent' recipient must never be reclaimed/resent");
    });

    it("reclaims (retries) a stub or failed delivery, but not a skipped one", async () => {
      const campaign = await createCampaign("EMAIL", "SENDING");
      createdCampaignIds.push(campaign.id);

      const stubRecipient = `claim-stub-${randomUUID()}@example.com`;
      const stubClaim = await claimRecipientForSending(campaign.id, stubRecipient, "EMAIL");
      await db.campaignDelivery.update({ where: { id: stubClaim! }, data: { status: "stub" } });
      // F-265 fix under test: retrying (e.g. once Brevo is configured, or on
      // a resumed run) must actually re-attempt a recipient whose earlier
      // delivery was "stub" — the old alreadyAttempted-snapshot approach
      // counted this as permanently done.
      const stubRetry = await claimRecipientForSending(campaign.id, stubRecipient, "EMAIL");
      assert.ok(stubRetry, "a 'stub' delivery must be retryable");
      assert.equal(stubRetry, stubClaim, "the retry should reclaim the SAME delivery row, not create a duplicate");

      const failedRecipient = `claim-failed-${randomUUID()}@example.com`;
      const failedClaim = await claimRecipientForSending(campaign.id, failedRecipient, "EMAIL");
      await db.campaignDelivery.update({ where: { id: failedClaim! }, data: { status: "failed" } });
      const failedRetry = await claimRecipientForSending(campaign.id, failedRecipient, "EMAIL");
      assert.ok(failedRetry, "a 'failed' delivery must be retryable");

      const skippedRecipient = `claim-skipped-${randomUUID()}@example.com`;
      const skippedClaim = await claimRecipientForSending(campaign.id, skippedRecipient, "EMAIL");
      await db.campaignDelivery.update({ where: { id: skippedClaim! }, data: { status: "skipped" } });
      const skippedRetry = await claimRecipientForSending(campaign.id, skippedRecipient, "EMAIL");
      assert.equal(skippedRetry, null, "a 'skipped' (e.g. no consent/opt-in) delivery must not be retried");
    });
  });

  describe("dispatchCampaign provider preflight (F-265)", () => {
    it("throws ProviderNotConfiguredError and leaves the campaign unclaimed when Brevo is off and there IS someone to send to", async () => {
      const segment = await db.customerSegment.create({
        data: {
          name: `Preflight segment ${randomUUID()}`,
          slug: `preflight-segment-${randomUUID()}`,
          criteria: JSON.stringify({ consent: true }),
        },
      });
      const subscriber = await db.newsletterSubscriber.create({
        data: {
          email: `preflight-${randomUUID()}@example.com`,
          consentGiven: true,
          confirmedAt: new Date(),
        },
      });
      const template = await db.messageTemplate.create({
        data: { name: `Preflight template ${randomUUID()}`, channel: "EMAIL", subject: "Hi", body: "Hi" },
      });
      const campaign = await db.campaign.create({
        data: {
          name: `Preflight campaign ${randomUUID()}`,
          channel: "EMAIL",
          status: "APPROVED",
          segmentId: segment.id,
          templateId: template.id,
        },
      });
      createdCampaignIds.push(campaign.id);

      await assert.rejects(() => dispatchCampaign(campaign.id), ProviderNotConfiguredError);

      const unchanged = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
      assert.equal(unchanged.status, "APPROVED", "the campaign must not be claimed into SENDING when the provider isn't ready");
      const deliveries = await db.campaignDelivery.count({ where: { campaignId: campaign.id } });
      assert.equal(deliveries, 0, "no delivery attempt should have been made");

      await db.newsletterSubscriber.delete({ where: { id: subscriber.id } }).catch(() => {});
      await db.customerSegment.delete({ where: { id: segment.id } }).catch(() => {});
      await db.messageTemplate.delete({ where: { id: template.id } }).catch(() => {});
    });

    it("F-212: an EMPTY segment is still finalized FAILED even when the provider is off (nothing would be sent either way)", async () => {
      const segment = await db.customerSegment.create({
        data: {
          name: `Preflight empty segment ${randomUUID()}`,
          slug: `preflight-empty-segment-${randomUUID()}`,
          // {} matches none of resolveSegmentRecipients' branches.
          criteria: JSON.stringify({}),
        },
      });
      const template = await db.messageTemplate.create({
        data: { name: `Preflight empty template ${randomUUID()}`, channel: "EMAIL", subject: "Hi", body: "Hi" },
      });
      const campaign = await db.campaign.create({
        data: {
          name: `Preflight empty campaign ${randomUUID()}`,
          channel: "EMAIL",
          status: "APPROVED",
          segmentId: segment.id,
          templateId: template.id,
        },
      });
      createdCampaignIds.push(campaign.id);

      const result = await dispatchCampaign(campaign.id);
      assert.equal(result.total, 0);

      const reloaded = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
      assert.equal(reloaded.status, "FAILED", "an empty audience is a real, permanent outcome regardless of provider config");

      await db.customerSegment.delete({ where: { id: segment.id } }).catch(() => {});
      await db.messageTemplate.delete({ where: { id: template.id } }).catch(() => {});
    });

    it("processDueScheduledCampaigns does not raise a dispatch-failed notification for a provider-not-configured campaign", async () => {
      const segment = await db.customerSegment.create({
        data: {
          name: `Preflight cron segment ${randomUUID()}`,
          slug: `preflight-cron-segment-${randomUUID()}`,
          criteria: JSON.stringify({ consent: true }),
        },
      });
      const subscriber = await db.newsletterSubscriber.create({
        data: {
          email: `preflight-cron-${randomUUID()}@example.com`,
          consentGiven: true,
          confirmedAt: new Date(),
        },
      });
      const template = await db.messageTemplate.create({
        data: { name: `Preflight cron template ${randomUUID()}`, channel: "EMAIL", subject: "Hi", body: "Hi" },
      });
      const campaign = await db.campaign.create({
        data: {
          name: `Preflight cron campaign ${randomUUID()}`,
          channel: "EMAIL",
          status: "SCHEDULED",
          scheduledAt: new Date(Date.now() - 1000),
          segmentId: segment.id,
          templateId: template.id,
        },
      });
      createdCampaignIds.push(campaign.id);

      await processDueScheduledCampaigns();

      const notification = await db.adminNotification.findFirst({
        where: { type: "campaign_dispatch_error", body: { contains: campaign.id } },
      });
      // The generic error path stores campaignId in metadata rather than
      // body, so also check by title (which does include the campaign
      // name) as a second, more direct check.
      const notificationByTitle = await db.adminNotification.findFirst({
        where: { type: "campaign_dispatch_error", title: `Campaign failed: ${campaign.name}` },
      });
      assert.equal(notification, null);
      assert.equal(notificationByTitle, null, "provider-not-configured must not spam an AdminNotification every tick");

      const unchanged = await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
      assert.equal(unchanged.status, "SCHEDULED", "should remain SCHEDULED, ready to retry once configured");

      await db.newsletterSubscriber.delete({ where: { id: subscriber.id } }).catch(() => {});
      await db.customerSegment.delete({ where: { id: segment.id } }).catch(() => {});
      await db.messageTemplate.delete({ where: { id: template.id } }).catch(() => {});
    });
  });
});
