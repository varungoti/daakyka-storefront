import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { subscribeToNewsletter, confirmNewsletterSubscriber } from "@/lib/engagement/newsletter";
import { unsubscribeByToken, isValidUnsubscribeToken } from "@/lib/engagement/unsubscribe";
import { resolveSegmentRecipients } from "@/lib/engagement/segment-resolver";
import { claimCampaignForSending } from "@/lib/engagement/campaign-dispatcher";
import { claimCronRun } from "@/lib/cron/idempotency";

const testEmails: string[] = [];

function testEmail(label: string): string {
  const email = `engagement-compliance-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  testEmails.push(email);
  return email;
}

describe("engagement compliance", () => {
  after(async () => {
    if (testEmails.length > 0) {
      await db.journeyEvent.deleteMany({
        where: { recipient: { in: testEmails } },
      });
      await db.journeyEnrollment.deleteMany({ where: { email: { in: testEmails } } });
      await db.newsletterSubscriber.deleteMany({ where: { email: { in: testEmails } } });
    }
    await db.customerSegment.deleteMany({ where: { slug: { startsWith: "test-marketing-seg-" } } });
    await db.contactEnquiry.deleteMany({ where: { email: { startsWith: "engagement-compliance-" } } });
    await db.cronRun.deleteMany({ where: { job: "test-idempotent-job" } });
  });

  describe("double opt-in subscribe/confirm", () => {
    it("subscribe creates an unconfirmed subscriber and does not enroll in a journey", async () => {
      const email = testEmail("subscribe");
      const result = await subscribeToNewsletter({ email, source: "test" });
      assert.ok(result.id);
      assert.equal(result.alreadyConfirmed, false);

      const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
      assert.ok(subscriber);
      assert.equal(subscriber?.confirmedAt, null);
      assert.ok(subscriber?.confirmToken);
      assert.ok(subscriber?.unsubscribeToken);

      const enrollment = await db.journeyEnrollment.findFirst({ where: { email } });
      assert.equal(enrollment, null);
    });

    it("confirm sets confirmedAt and now enrolls in the welcome journey", async () => {
      const email = testEmail("confirm");
      await subscribeToNewsletter({ email, source: "test" });
      const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
      assert.ok(subscriber?.confirmToken);

      const confirmResult = await confirmNewsletterSubscriber(subscriber!.confirmToken!);
      assert.equal(confirmResult.ok, true);

      const confirmed = await db.newsletterSubscriber.findUnique({ where: { email } });
      assert.ok(confirmed?.confirmedAt);
      assert.equal(confirmed?.confirmToken, null);

      const enrollment = await db.journeyEnrollment.findFirst({
        where: { email, journey: { slug: "welcome-series" } },
      });
      assert.ok(enrollment, "expected an enrollment in the seeded welcome-series journey");
    });

    it("resubscribe of a confirmed email does not duplicate-enroll", async () => {
      const email = testEmail("resubscribe");
      await subscribeToNewsletter({ email, source: "test" });
      const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
      await confirmNewsletterSubscriber(subscriber!.confirmToken!);

      // Simulate a duplicate confirm click (email prefetch, double click).
      const refetched = await db.newsletterSubscriber.findUnique({ where: { email } });
      // confirmToken is nulled after first confirm, so re-derive it isn't
      // possible — instead simulate the "resubscribe" path directly, which
      // is the realistic duplicate-trigger scenario per the compliance
      // build spec.
      const resubscribe = await subscribeToNewsletter({ email, source: "test-again" });
      assert.equal(resubscribe.alreadyConfirmed, true);

      const enrollments = await db.journeyEnrollment.findMany({
        where: { email, journey: { slug: "welcome-series" } },
      });
      assert.equal(enrollments.length, 1);
      assert.ok(refetched?.confirmedAt);
    });
  });

  describe("unsubscribe", () => {
    it("sets unsubscribedAt and cancels active enrollments", async () => {
      const email = testEmail("unsubscribe");
      await subscribeToNewsletter({ email, source: "test" });
      const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
      await confirmNewsletterSubscriber(subscriber!.confirmToken!);

      const activeBefore = await db.journeyEnrollment.findFirst({
        where: { email, status: "ACTIVE" },
      });
      assert.ok(activeBefore, "expected an ACTIVE enrollment before unsubscribing");

      const confirmedSubscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
      const result = await unsubscribeByToken(confirmedSubscriber!.unsubscribeToken);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.email, email);
        assert.equal(result.alreadyUnsubscribed, false);
      }

      const afterUnsub = await db.newsletterSubscriber.findUnique({ where: { email } });
      assert.ok(afterUnsub?.unsubscribedAt);

      const activeAfter = await db.journeyEnrollment.findFirst({
        where: { email, status: "ACTIVE" },
      });
      assert.equal(activeAfter, null);

      // Idempotent: calling it again is a no-op, not an error.
      const second = await unsubscribeByToken(confirmedSubscriber!.unsubscribeToken);
      assert.equal(second.ok, true);
      if (second.ok) assert.equal(second.alreadyUnsubscribed, true);
    });

    it("rejects a malformed token without hitting the database", async () => {
      assert.equal(isValidUnsubscribeToken("not-a-real-token"), false);
      const result = await unsubscribeByToken("not-a-real-token");
      assert.equal(result.ok, false);
    });
  });

  describe("segment resolver consent filtering", () => {
    it("excludes unconfirmed and unsubscribed subscribers from the newsletter segment", async () => {
      const confirmedEmail = testEmail("seg-confirmed");
      const unconfirmedEmail = testEmail("seg-unconfirmed");
      const unsubscribedEmail = testEmail("seg-unsubscribed");

      await subscribeToNewsletter({ email: confirmedEmail, source: "test" });
      const confirmedSub = await db.newsletterSubscriber.findUnique({
        where: { email: confirmedEmail },
      });
      await confirmNewsletterSubscriber(confirmedSub!.confirmToken!);

      await subscribeToNewsletter({ email: unconfirmedEmail, source: "test" });

      await subscribeToNewsletter({ email: unsubscribedEmail, source: "test" });
      const unsubscribedSub = await db.newsletterSubscriber.findUnique({
        where: { email: unsubscribedEmail },
      });
      await confirmNewsletterSubscriber(unsubscribedSub!.confirmToken!);
      const reloaded = await db.newsletterSubscriber.findUnique({
        where: { email: unsubscribedEmail },
      });
      await unsubscribeByToken(reloaded!.unsubscribeToken);

      const segment = await db.customerSegment.create({
        data: {
          name: "Test Marketing Segment",
          slug: `test-marketing-seg-${randomUUID().slice(0, 8)}`,
          criteria: JSON.stringify({ source: "newsletter", consent: true }),
        },
      });

      const recipients = await resolveSegmentRecipients(segment.id);
      const recipientEmails = recipients.map((r) => r.email);

      assert.ok(recipientEmails.includes(confirmedEmail));
      assert.ok(!recipientEmails.includes(unconfirmedEmail));
      assert.ok(!recipientEmails.includes(unsubscribedEmail));

      await db.customerSegment.delete({ where: { id: segment.id } });
    });

    it("no longer falls back to ContactEnquiry for a pages-based marketing segment", async () => {
      const enquiryEmail = `engagement-compliance-enquiry-${Date.now()}@example.com`;
      await db.contactEnquiry.create({
        data: {
          name: "Test Enquirer",
          email: enquiryEmail,
          type: "BULK_ORDER",
          message: "Test enquiry — should never be treated as a marketing recipient.",
        },
      });

      const segment = await db.customerSegment.create({
        data: {
          name: "Test Pages Segment",
          slug: `test-marketing-seg-pages-${randomUUID().slice(0, 8)}`,
          criteria: JSON.stringify({ pages: ["/mix-and-match"] }),
        },
      });

      const recipients = await resolveSegmentRecipients(segment.id);
      assert.ok(!recipients.some((r) => r.email === enquiryEmail));

      await db.customerSegment.delete({ where: { id: segment.id } });
    });
  });

  describe("campaign send idempotency", () => {
    it("claim-then-send: a second concurrent claim attempt is a no-op", async () => {
      const segment = await db.customerSegment.create({
        data: {
          name: "Test Claim Segment",
          slug: `test-marketing-seg-claim-${randomUUID().slice(0, 8)}`,
          criteria: JSON.stringify({ source: "newsletter", consent: true }),
        },
      });
      const template = await db.messageTemplate.create({
        data: {
          name: "Test Claim Template",
          channel: "EMAIL",
          subject: "Test",
          body: "Hi {{first_name}}",
        },
      });
      const campaign = await db.campaign.create({
        data: {
          name: "Test Claim Campaign",
          channel: "EMAIL",
          status: "SCHEDULED",
          segmentId: segment.id,
          templateId: template.id,
          scheduledAt: new Date(),
        },
      });

      const firstClaim = await claimCampaignForSending(campaign.id);
      const secondClaim = await claimCampaignForSending(campaign.id);

      assert.equal(firstClaim, true);
      assert.equal(secondClaim, false);

      const reloaded = await db.campaign.findUnique({ where: { id: campaign.id } });
      assert.equal(reloaded?.status, "SENDING");

      await db.campaign.delete({ where: { id: campaign.id } });
      await db.messageTemplate.delete({ where: { id: template.id } });
      await db.customerSegment.delete({ where: { id: segment.id } });
    });

    it("CampaignDelivery's unique constraint prevents a duplicate row for the same recipient", async () => {
      const segment = await db.customerSegment.create({
        data: {
          name: "Test Delivery Segment",
          slug: `test-marketing-seg-delivery-${randomUUID().slice(0, 8)}`,
          criteria: JSON.stringify({ source: "newsletter", consent: true }),
        },
      });
      const template = await db.messageTemplate.create({
        data: { name: "Test Delivery Template", channel: "EMAIL", subject: "Test", body: "Hi" },
      });
      const campaign = await db.campaign.create({
        data: {
          name: "Test Delivery Campaign",
          channel: "EMAIL",
          status: "DRAFT",
          segmentId: segment.id,
          templateId: template.id,
        },
      });

      await db.campaignDelivery.create({
        data: {
          campaignId: campaign.id,
          recipient: "dup@example.com",
          channel: "EMAIL",
          status: "sent",
        },
      });

      await assert.rejects(() =>
        db.campaignDelivery.create({
          data: {
            campaignId: campaign.id,
            recipient: "dup@example.com",
            channel: "EMAIL",
            status: "sent",
          },
        }),
      );

      await db.campaign.delete({ where: { id: campaign.id } });
      await db.messageTemplate.delete({ where: { id: template.id } });
      await db.customerSegment.delete({ where: { id: segment.id } });
    });
  });

  describe("cron idempotency (CronRun)", () => {
    it("running the same job+runKey twice only claims (and processes) once", async () => {
      const runKey = `test-run-${Date.now()}`;
      let processed = 0;

      async function runJob() {
        const { claimed } = await claimCronRun("test-idempotent-job", runKey);
        if (!claimed) return;
        processed += 1;
      }

      await runJob();
      await runJob();
      await runJob();

      assert.equal(processed, 1);

      const rows = await db.cronRun.findMany({
        where: { job: "test-idempotent-job", runKey },
      });
      assert.equal(rows.length, 1);
    });
  });
});
