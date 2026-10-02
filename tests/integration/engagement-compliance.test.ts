import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { subscribeToNewsletter, confirmNewsletterSubscriber } from "@/lib/engagement/newsletter";
import { POST as postNewsletterSubscribe } from "@/app/api/newsletter/subscribe/route";
import { unsubscribeByToken, isValidUnsubscribeToken } from "@/lib/engagement/unsubscribe";
import { GET as getUnsubscribe, POST as postUnsubscribe } from "@/app/api/unsubscribe/route";
import { resolveSegmentRecipients } from "@/lib/engagement/segment-resolver";
import { claimCampaignForSending, dispatchCampaign } from "@/lib/engagement/campaign-dispatcher";
import { claimCronRun, runWithCronClaim } from "@/lib/cron/idempotency";
import { GET as getCampaignPreview } from "@/app/api/admin/campaigns/[id]/preview/route";
import { withEnv } from "../helpers/env";

const testEmails: string[] = [];

function testEmail(label: string): string {
  const email = `engagement-compliance-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  testEmails.push(email);
  return email;
}

describe("engagement compliance", () => {
  let welcomeJourneyOriginalStatus: string | undefined;

  before(async () => {
    // F-070: welcome-series is now seeded DRAFT, not ACTIVE (an ACTIVE
    // journey sends automatically once Brevo is enabled, so it should be
    // reviewed first) — this suite's double opt-in tests below depend on
    // it actually enrolling a confirmed subscriber, so force it ACTIVE for
    // the duration of this suite and restore whatever it was afterward.
    const journey = await db.customerJourney.findUnique({ where: { slug: "welcome-series" } });
    welcomeJourneyOriginalStatus = journey?.status;
    if (journey && journey.status !== "ACTIVE") {
      await db.customerJourney.update({ where: { slug: "welcome-series" }, data: { status: "ACTIVE" } });
    }
  });

  after(async () => {
    if (welcomeJourneyOriginalStatus && welcomeJourneyOriginalStatus !== "ACTIVE") {
      await db.customerJourney
        .update({ where: { slug: "welcome-series" }, data: { status: welcomeJourneyOriginalStatus as never } })
        .catch(() => {});
    }
  });

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

    // F-043: a confirm link is a live credential — with Brevo off or
    // erroring it used to be printed, with the address, to production logs.
    it("logs no confirm link or address in production, and queues the email with a sealed body (F-043)", async () => {
      const email = testEmail("scrub-prod");
      const lines: string[] = [];
      const originals = { log: console.log, warn: console.warn, error: console.error, info: console.info };
      const capture = (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      };
      console.log = capture;
      console.warn = capture;
      console.error = capture;
      console.info = capture;
      try {
        await withEnv({ NODE_ENV: "production" }, () => subscribeToNewsletter({ email, source: "test" }));
      } finally {
        Object.assign(console, originals);
      }

      const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
      assert.ok(subscriber?.confirmToken);
      const output = lines.join("\n");
      assert.ok(!output.includes(subscriber!.confirmToken!), "the confirm token must not reach the logs");
      assert.ok(!output.includes("newsletter/confirm"), "nor the confirm URL");
      assert.ok(!output.includes(email), "nor the subscriber's address");

      const outbox = await db.emailOutbox.findFirst({ where: { to: email, kind: "newsletter_confirm" } });
      assert.ok(outbox, "the confirmation email is still queued for delivery");
      assert.ok(!outbox!.html.includes(subscriber!.confirmToken!), "the stored body holds no readable token");
      await db.emailOutbox.deleteMany({ where: { to: email } });
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

    // F-050: an unsubscribed address used to be silently reactivated by a
    // bare POST to /api/newsletter/subscribe, with no fresh consent and no
    // confirmation email — see subscribeToNewsletter's doc comment.
    it("resubscribing an unsubscribed address requires a fresh confirmation click, not just a POST", async () => {
      const email = testEmail("resubscribe-after-unsub");
      await subscribeToNewsletter({ email, source: "test" });
      const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
      await confirmNewsletterSubscriber(subscriber!.confirmToken!);

      const confirmed = await db.newsletterSubscriber.findUnique({ where: { email } });
      await unsubscribeByToken(confirmed!.unsubscribeToken);

      const unsubscribed = await db.newsletterSubscriber.findUnique({ where: { email } });
      assert.ok(unsubscribed?.unsubscribedAt, "expected the address to be unsubscribed");

      // A third party (or the same shopper) POSTs the address again, with
      // no proof of ownership beyond knowing the email.
      const resubscribe = await subscribeToNewsletter({ email, source: "audit-3rdparty" });
      assert.equal(resubscribe.alreadyConfirmed, false, "must not be treated as a no-op reactivation");

      const afterResubscribe = await db.newsletterSubscriber.findUnique({ where: { email } });
      assert.ok(afterResubscribe?.unsubscribedAt, "unsubscribedAt must stay set until the new link is clicked");
      assert.ok(afterResubscribe?.confirmToken, "a fresh confirmToken must be issued");
      assert.notEqual(afterResubscribe?.confirmToken, subscriber?.confirmToken, "the token must be new, not reused");

      // Only clicking the fresh confirmation link actually reactivates it,
      // and it must not replay the welcome journey a second time.
      const reconfirm = await confirmNewsletterSubscriber(afterResubscribe!.confirmToken!);
      assert.equal(reconfirm.ok, true);

      const reactivated = await db.newsletterSubscriber.findUnique({ where: { email } });
      assert.equal(reactivated?.unsubscribedAt, null);
      assert.ok(reactivated?.confirmedAt);

      const enrollments = await db.journeyEnrollment.findMany({
        where: { email, journey: { slug: "welcome-series" } },
      });
      assert.equal(enrollments.length, 1, "resubscribing must not re-enroll in the welcome series");
    });

    // F-050: the API response used to differ ("You're already subscribed."
    // vs "Check your inbox…") and echo back the subscriber's stable id,
    // letting anyone probe whether an address is a confirmed subscriber.
    it("POST /api/newsletter/subscribe returns an identical body for a new and an already-subscribed address", async () => {
      const newEmail = testEmail("oracle-new");
      const existingEmail = testEmail("oracle-existing");
      await subscribeToNewsletter({ email: existingEmail, source: "test" });
      const existingSubscriber = await db.newsletterSubscriber.findUnique({ where: { email: existingEmail } });
      await confirmNewsletterSubscriber(existingSubscriber!.confirmToken!);

      function request(email: string) {
        return new Request("http://localhost/api/newsletter/subscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, consentGiven: true, source: "test" }),
        });
      }

      const newResponse = await postNewsletterSubscribe(request(newEmail));
      const existingResponse = await postNewsletterSubscribe(request(existingEmail));

      assert.equal(newResponse.status, 200);
      assert.equal(existingResponse.status, 200);
      const newBody = (await newResponse.json()) as Record<string, unknown>;
      const existingBody = (await existingResponse.json()) as Record<string, unknown>;

      assert.deepEqual(newBody, existingBody, "response body must not reveal subscription state");
      assert.equal(newBody.id, undefined, "response must not echo a subscriber id");
      // F-086: the one message has to be true for both — it must not promise an
      // email to an address that gets none, nor say who is subscribed.
      assert.match(String(newBody.message), /^If this address isn't already subscribed/);
    });
  });

  describe("unsubscribe", () => {
    it("sets unsubscribedAt and cancels active enrollments", async () => {
      const email = testEmail("unsubscribe");
      await subscribeToNewsletter({ email, source: "test" });
      const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
      await confirmNewsletterSubscriber(subscriber!.confirmToken!);

      // F-070: welcome-series now seeds a single, immediate (delayHours: 0)
      // step, so its own enrollment for this email completes the instant
      // it's created — there's nothing left pending to cancel. Add a
      // throwaway journey with a future step so there's a genuinely ACTIVE
      // enrollment to exercise unsubscribeByToken's documented contract
      // ("cancels every currently-ACTIVE JourneyEnrollment for that
      // email") against, independent of any particular seeded journey's
      // step count.
      const testJourney = await db.customerJourney.create({
        data: {
          name: `Test Unsubscribe Journey ${randomUUID().slice(0, 8)}`,
          slug: `test-unsubscribe-journey-${randomUUID().slice(0, 8)}`,
          trigger: "test_unsubscribe_trigger",
          status: "ACTIVE",
        },
      });
      await db.journeyStep.create({
        data: {
          journeyId: testJourney.id,
          sortOrder: 0,
          name: "Future step",
          delayHours: 24,
          channel: "EMAIL",
        },
      });
      await db.journeyEnrollment.create({
        data: {
          journeyId: testJourney.id,
          email,
          currentStep: 0,
          context: "{}",
          trigger: testJourney.trigger,
          nextRunAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          status: "ACTIVE",
        },
      });

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

      await db.journeyEnrollment.deleteMany({ where: { journeyId: testJourney.id } });
      await db.journeyStep.deleteMany({ where: { journeyId: testJourney.id } });
      await db.customerJourney.delete({ where: { id: testJourney.id } });
    });

    it("rejects a malformed token without hitting the database", async () => {
      assert.equal(isValidUnsubscribeToken("not-a-real-token"), false);
      const result = await unsubscribeByToken("not-a-real-token");
      assert.equal(result.ok, false);
    });

    // F-055: GET used to unsubscribe (a mail scanner prefetching the
    // List-Unsubscribe URL could silently unsubscribe a recipient) and
    // answered with raw JSON. It must only redirect to the confirmation page.
    it("GET /api/unsubscribe redirects to the confirmation page without unsubscribing", async () => {
      const email = testEmail("unsubscribe-get");
      await subscribeToNewsletter({ email, source: "test" });
      const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
      await confirmNewsletterSubscriber(subscriber!.confirmToken!);
      const confirmed = await db.newsletterSubscriber.findUnique({ where: { email } });

      const response = await getUnsubscribe(
        new Request(`http://localhost/api/unsubscribe?token=${confirmed!.unsubscribeToken}`),
      );
      assert.equal(response.status, 303);
      const location = new URL(response.headers.get("location") ?? "");
      assert.equal(location.pathname, "/unsubscribe");
      assert.equal(location.searchParams.get("token"), confirmed!.unsubscribeToken);

      const after = await db.newsletterSubscriber.findUnique({ where: { email } });
      assert.equal(after?.unsubscribedAt, null, "a GET must never unsubscribe");
    });

    it("GET /api/unsubscribe without a token still lands on the page, which explains the missing token", async () => {
      const response = await getUnsubscribe(new Request("http://localhost/api/unsubscribe"));
      assert.equal(response.status, 303);
      const location = new URL(response.headers.get("location") ?? "");
      assert.equal(location.pathname, "/unsubscribe");
      assert.equal(location.search, "");
    });

    it("POST /api/unsubscribe still unsubscribes (RFC 8058 one-click) and answers 400 for an unknown link", async () => {
      const email = testEmail("unsubscribe-post");
      await subscribeToNewsletter({ email, source: "test" });
      const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });
      await confirmNewsletterSubscriber(subscriber!.confirmToken!);
      const confirmed = await db.newsletterSubscriber.findUnique({ where: { email } });

      const ok = await postUnsubscribe(
        new Request(`http://localhost/api/unsubscribe?token=${confirmed!.unsubscribeToken}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "List-Unsubscribe=One-Click",
        }),
      );
      assert.equal(ok.status, 200);
      const after = await db.newsletterSubscriber.findUnique({ where: { email } });
      assert.ok(after?.unsubscribedAt);

      const invalid = await postUnsubscribe(
        new Request("http://localhost/api/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "cinvalidtoken000000000000" }),
        }),
      );
      assert.equal(invalid.status, 400);
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

  describe("campaign dispatch reporting (F-212)", () => {
    it("a send with no eligible recipients is reported FAILED, not silently marked SENT", async () => {
      const segment = await db.customerSegment.create({
        data: {
          name: "Test Empty Segment",
          slug: `test-marketing-seg-empty-${randomUUID().slice(0, 8)}`,
          // {} matches none of resolveSegmentRecipients' branches, so this
          // always resolves to zero recipients regardless of seeded data.
          criteria: JSON.stringify({}),
        },
      });
      const template = await db.messageTemplate.create({
        data: { name: "Test Empty Segment Template", channel: "EMAIL", subject: "Test", body: "Hi" },
      });
      const campaign = await db.campaign.create({
        data: {
          name: `Test Empty Segment Campaign ${randomUUID().slice(0, 8)}`,
          channel: "EMAIL",
          status: "APPROVED",
          segmentId: segment.id,
          templateId: template.id,
        },
      });

      const result = await dispatchCampaign(campaign.id);
      assert.equal(result.total, 0);
      assert.equal(result.sent, 0);

      // Before this fix, a zero-recipient run left the campaign SENT —
      // indistinguishable from a real, successful send.
      const reloaded = await db.campaign.findUnique({ where: { id: campaign.id } });
      assert.equal(reloaded?.status, "FAILED");

      const deliveries = await db.campaignDelivery.findMany({ where: { campaignId: campaign.id } });
      assert.equal(deliveries.length, 0);

      const notification = await db.adminNotification.findFirst({
        where: { type: "campaign_dispatch", title: { contains: campaign.name } },
        orderBy: { createdAt: "desc" },
      });
      assert.ok(notification, "expected a campaign_dispatch AdminNotification");
      assert.match(notification!.title, /failed/i);

      if (notification) await db.adminNotification.delete({ where: { id: notification.id } });
      await db.campaign.delete({ where: { id: campaign.id } });
      await db.messageTemplate.delete({ where: { id: template.id } });
      await db.customerSegment.delete({ where: { id: segment.id } });
    });
  });

  describe("GET /api/admin/campaigns/[id]/preview without a session", () => {
    it("rejects with 401 when the route handler is called directly with no session", async () => {
      // Same "mock nothing" auth-less check as tests/integration/site-settings.test.ts —
      // calling the handler directly outside a real Next.js request means
      // requireAdminPermission's getSession() fails closed.
      const request = new Request("http://localhost/api/admin/campaigns/does-not-matter/preview");
      const response = await getCampaignPreview(request, {
        params: Promise.resolve({ id: "does-not-matter" }),
      });
      assert.ok(
        response.status === 401 || response.status === 403,
        `expected 401 or 403, got ${response.status}`,
      );
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

    // F-277: the claim is written before the job body runs, so a crashed run
    // used to leave it behind and every same-window retry answered
    // "alreadyRan" — the week's report / the day's journeys were skipped.
    it("runWithCronClaim keeps the claim after a successful run, so a duplicate trigger is still a no-op", async () => {
      const runKey = `test-run-ok-${Date.now()}`;
      let runs = 0;

      const first = await runWithCronClaim("test-idempotent-job", runKey, async () => {
        runs += 1;
        return "done";
      });
      const second = await runWithCronClaim("test-idempotent-job", runKey, async () => {
        runs += 1;
        return "done again";
      });

      assert.deepEqual(first, { claimed: true, result: "done" });
      assert.deepEqual(second, { claimed: false });
      assert.equal(runs, 1);
      assert.equal(await db.cronRun.count({ where: { job: "test-idempotent-job", runKey } }), 1);
    });

    it("runWithCronClaim releases the claim and rethrows when the job fails, so the next invocation re-runs it (F-277)", async () => {
      const runKey = `test-run-crash-${Date.now()}`;

      await assert.rejects(
        () =>
          runWithCronClaim("test-idempotent-job", runKey, async () => {
            throw new Error("permission denied for table OrderEvent");
          }),
        /permission denied/,
      );
      assert.equal(
        await db.cronRun.count({ where: { job: "test-idempotent-job", runKey } }),
        0,
        "a failed run must not leave its claim behind",
      );

      // The retry in the same window is allowed to do the work...
      let retried = false;
      const retry = await runWithCronClaim("test-idempotent-job", runKey, async () => {
        retried = true;
        return 42;
      });
      assert.deepEqual(retry, { claimed: true, result: 42 });
      assert.equal(retried, true);

      // ...and once it succeeds the window is claimed again.
      const duplicate = await runWithCronClaim("test-idempotent-job", runKey, async () => 0);
      assert.deepEqual(duplicate, { claimed: false });
    });

    it("releasing a claim for one window never touches another job's or window's claim", async () => {
      const keepKey = `test-run-keep-${Date.now()}`;
      const failKey = `test-run-fail-${Date.now()}`;
      await claimCronRun("test-idempotent-job", keepKey);

      await assert.rejects(() =>
        runWithCronClaim("test-idempotent-job", failKey, async () => {
          throw new Error("boom");
        }),
      );

      assert.equal(await db.cronRun.count({ where: { job: "test-idempotent-job", runKey: keepKey } }), 1);
    });
  });
});
