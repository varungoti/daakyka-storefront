import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { claimEnrollment, processDueEnrollments, triggerJourneys } from "@/lib/engagement/journey-engine";

/**
 * Release-hardening batch 3a (engagement-journeys-campaigns-reliability):
 * F-079/F-278 (overlapping/backlogged cron runs must not double- or
 * burst-send journey steps), F-264 (a step whose provider isn't configured
 * must not be silently advanced past) and F-317 (a non-immediate WhatsApp
 * step needs an explicit WhatsAppOptIn).
 *
 * These talk to the real (isolated test) database, same pattern as
 * outbox.test.ts — journey-engine.ts has no injectable DB, and the bugs
 * being fixed are specifically about DB-level claim/scheduling races, so a
 * mock wouldn't exercise the actual guard.
 */

const createdJourneyIds: string[] = [];

type StepInput = {
  name: string;
  delayHours: number;
  channel: "ADMIN_NOTIFICATION" | "EMAIL" | "WHATSAPP";
  templateId?: string | null;
};

async function createJourney(trigger: string, steps: StepInput[]) {
  const suffix = randomUUID();
  const journey = await db.customerJourney.create({
    data: {
      name: `Test journey ${suffix}`,
      slug: `test-journey-${suffix}`,
      trigger,
      status: "ACTIVE",
      steps: {
        create: steps.map((s, i) => ({
          sortOrder: i,
          name: s.name,
          delayHours: s.delayHours,
          channel: s.channel,
          templateId: s.templateId ?? null,
        })),
      },
    },
    include: { steps: { orderBy: { sortOrder: "asc" } } },
  });
  createdJourneyIds.push(journey.id);
  return journey;
}

async function createEnrollment(opts: {
  journeyId: string;
  trigger: string;
  currentStep: number;
  createdAt: Date;
  nextRunAt: Date | null;
  email?: string;
  phone?: string;
  context?: Record<string, unknown>;
}) {
  return db.journeyEnrollment.create({
    data: {
      journeyId: opts.journeyId,
      trigger: opts.trigger,
      currentStep: opts.currentStep,
      createdAt: opts.createdAt,
      nextRunAt: opts.nextRunAt,
      email: opts.email,
      phone: opts.phone,
      context: JSON.stringify(opts.context ?? { email: opts.email, phone: opts.phone }),
    },
  });
}

describe("journey-engine (release-hardening batch 3a)", () => {
  after(async () => {
    if (createdJourneyIds.length > 0) {
      // CustomerJourney -> steps/events/enrollments all cascade on delete.
      await db.customerJourney.deleteMany({ where: { id: { in: createdJourneyIds } } }).catch(() => {});
    }
  });

  describe("claimEnrollment (F-278)", () => {
    it("refuses a claim whose expected currentStep no longer matches the row", async () => {
      const journey = await createJourney(`test_claim_${randomUUID()}`, [
        { name: "step0", delayHours: 0, channel: "ADMIN_NOTIFICATION" },
        { name: "step1", delayHours: 1, channel: "ADMIN_NOTIFICATION" },
      ]);
      const enrollment = await createEnrollment({
        journeyId: journey.id,
        trigger: journey.trigger,
        currentStep: 1, // "already advanced by another run"
        createdAt: new Date(),
        nextRunAt: new Date(),
      });

      const staleBefore = new Date(Date.now() - 10 * 60 * 1000);

      // A stale snapshot (from before the advance) still thinks currentStep
      // is 0 — the claim must fail, not silently re-process step 0.
      const staleClaim = await claimEnrollment(enrollment.id, 0, staleBefore);
      assert.equal(staleClaim, false, "a claim against a stale currentStep snapshot must not succeed");

      // The correct, up-to-date snapshot's claim must still succeed.
      const freshClaim = await claimEnrollment(enrollment.id, 1, staleBefore);
      assert.equal(freshClaim, true, "a claim matching the row's real currentStep must succeed");

      // Immediately re-claiming with the same (now-locked) step must fail —
      // this is the pre-existing lock guard, still expected to hold.
      const relock = await claimEnrollment(enrollment.id, 1, staleBefore);
      assert.equal(relock, false, "a freshly-locked row must not be claimable again immediately");
    });
  });

  describe("processDueEnrollments (F-079: no back-to-back burst sends)", () => {
    it("sends at most one step per enrollment per run even when multiple steps are already overdue", async () => {
      const trigger = `test_burst_${randomUUID()}`;
      const journey = await createJourney(trigger, [
        { name: "step0", delayHours: 0, channel: "ADMIN_NOTIFICATION" },
        { name: "step1", delayHours: 1, channel: "ADMIN_NOTIFICATION" },
      ]);
      const createdAt = new Date(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
      const enrollment = await createEnrollment({
        journeyId: journey.id,
        trigger,
        currentStep: 0,
        createdAt,
        // Both step0 (delay 0) and step1's anchor (createdAt + 1h) are
        // already well in the past — the old anchored-to-createdAt logic
        // would send both in this same run.
        nextRunAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      await processDueEnrollments();

      const afterFirstRun = await db.journeyEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
      const eventsAfterFirstRun = await db.journeyEvent.count({ where: { journeyId: journey.id } });

      assert.equal(eventsAfterFirstRun, 1, "only step0 should have been sent in this run");
      assert.equal(afterFirstRun.currentStep, 1, "should have advanced past step0");
      assert.equal(afterFirstRun.status, "ACTIVE");
      assert.ok(
        afterFirstRun.nextRunAt && afterFirstRun.nextRunAt.getTime() > Date.now(),
        "step1's nextRunAt must be pushed into the future, not left overdue",
      );

      // A second run right away must NOT also fire step1 — it isn't due yet.
      await processDueEnrollments();
      const eventsAfterSecondRun = await db.journeyEvent.count({ where: { journeyId: journey.id } });
      assert.equal(eventsAfterSecondRun, 1, "step1 must not fire until its (pushed-out) nextRunAt arrives");
    });

    it("two overlapping runs on the same overdue enrollment still send it only once (F-278)", async () => {
      const trigger = `test_overlap_${randomUUID()}`;
      const journey = await createJourney(trigger, [
        { name: "only-step", delayHours: 0, channel: "ADMIN_NOTIFICATION" },
      ]);
      const enrollment = await createEnrollment({
        journeyId: journey.id,
        trigger,
        currentStep: 0,
        createdAt: new Date(),
        nextRunAt: new Date(Date.now() - 1000),
      });

      await Promise.all([processDueEnrollments(), processDueEnrollments()]);

      const events = await db.journeyEvent.count({ where: { journeyId: journey.id } });
      assert.equal(events, 1, "concurrent runs must not both send the same due step");

      const finalEnrollment = await db.journeyEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
      assert.equal(finalEnrollment.status, "COMPLETED");
    });
  });

  describe("stub steps are retried, not silently advanced past (F-264)", () => {
    it("an immediate EMAIL step with Brevo unconfigured keeps the enrollment on step 0 and reschedules it", async () => {
      const trigger = `test_stub_${randomUUID()}`;
      const template = await db.messageTemplate.create({
        data: {
          name: `Stub retry template ${randomUUID()}`,
          channel: "EMAIL",
          subject: "Test",
          body: "Hi {{first_name}}",
        },
      });
      const journey = await createJourney(trigger, [
        { name: "welcome-email", delayHours: 0, channel: "EMAIL", templateId: template.id },
      ]);
      const email = `journey-stub-${randomUUID()}@example.com`;
      // sendMarketingEmail requires a confirmed subscriber before it even
      // reaches the (unconfigured, in this test environment) Brevo call —
      // otherwise the result would be "skipped" (no consent), not "stub".
      const subscriber = await db.newsletterSubscriber.create({
        data: { email, consentGiven: true, confirmedAt: new Date() },
      });

      const { enrollments } = await triggerJourneys(trigger, { email });
      assert.equal(enrollments.length, 1, "expected exactly one enrollment to be created");

      const enrollment = await db.journeyEnrollment.findUniqueOrThrow({ where: { id: enrollments[0] } });
      assert.equal(enrollment.status, "ACTIVE");
      assert.equal(enrollment.currentStep, 0, "must NOT have advanced past the un-attempted (stub) step");
      assert.ok(enrollment.nextRunAt, "must be scheduled for a retry");
      assert.ok(
        enrollment.nextRunAt!.getTime() > Date.now(),
        "the retry must be scheduled for later, not immediately re-attempted on every tick",
      );

      const events = await db.journeyEvent.findMany({ where: { journeyId: journey.id } });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.status, "stub");

      await db.newsletterSubscriber.delete({ where: { id: subscriber.id } }).catch(() => {});
      await db.messageTemplate.delete({ where: { id: template.id } }).catch(() => {});
    });
  });

  describe("WhatsApp opt-in gate (F-317)", () => {
    it("skips a non-immediate WhatsApp step for a phone with no WhatsAppOptIn row, and still advances the enrollment", async () => {
      const trigger = `test_wa_consent_${randomUUID()}`;
      const template = await db.messageTemplate.create({
        data: { name: `WA gate template ${randomUUID()}`, channel: "WHATSAPP", body: "Hi {{first_name}}" },
      });
      const journey = await createJourney(trigger, [
        { name: "ack", delayHours: 0, channel: "WHATSAPP", templateId: template.id },
        { name: "follow-up", delayHours: 48, channel: "WHATSAPP", templateId: template.id },
      ]);
      const phone = `9${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "2")}`;

      // Skip straight to the marketing follow-up step (index 1) being due —
      // the immediate ack (index 0) is a separate, already-tested code path.
      const enrollment = await createEnrollment({
        journeyId: journey.id,
        trigger,
        currentStep: 1,
        createdAt: new Date(Date.now() - 49 * 60 * 60 * 1000),
        nextRunAt: new Date(Date.now() - 1000),
        phone,
      });

      await processDueEnrollments();

      const event = await db.journeyEvent.findFirstOrThrow({ where: { journeyId: journey.id } });
      assert.equal(event.status, "skipped");
      assert.match(event.metadata ?? "", /no_whatsapp_opt_in/);

      const finalEnrollment = await db.journeyEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
      assert.equal(finalEnrollment.status, "COMPLETED", "a consent-skip must still advance the enrollment");

      await db.messageTemplate.delete({ where: { id: template.id } }).catch(() => {});
    });

    it("does not gate the immediate (delayHours 0) WhatsApp step on consent", async () => {
      const trigger = `test_wa_immediate_${randomUUID()}`;
      const template = await db.messageTemplate.create({
        data: { name: `WA immediate template ${randomUUID()}`, channel: "WHATSAPP", body: "Hi {{first_name}}" },
      });
      const journey = await createJourney(trigger, [
        { name: "ack", delayHours: 0, channel: "WHATSAPP", templateId: template.id },
      ]);
      const phone = `9${randomUUID().replace(/\D/g, "").slice(0, 9).padEnd(9, "3")}`;

      await triggerJourneys(trigger, { phone });

      const event = await db.journeyEvent.findFirstOrThrow({ where: { journeyId: journey.id } });
      // WATI isn't configured in this test environment either, so the
      // immediate step's outcome is "stub" (attempted, provider unset) —
      // the point being asserted is that it is NOT "skipped" with the
      // consent reason, i.e. the consent gate never ran for it.
      assert.notEqual(event.status, "skipped");
      assert.doesNotMatch(event.metadata ?? "", /no_whatsapp_opt_in/);

      await db.messageTemplate.delete({ where: { id: template.id } }).catch(() => {});
    });
  });
});
