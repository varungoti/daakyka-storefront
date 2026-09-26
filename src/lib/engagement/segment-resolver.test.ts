import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { resolveSegmentRecipients } from "@/lib/engagement/segment-resolver";

/**
 * Release-hardening batch 3a (engagement-journeys-campaigns-reliability):
 * F-270 (no real name on file must not fall back to the email local part —
 * that's template.ts/buildEngagementVars' job now, via an unset firstName)
 * and F-337 (the newsletter/bulk-order `take` caps were removed).
 */

describe("segment-resolver (release-hardening batch 3a)", () => {
  const createdSubscriberIds: string[] = [];
  const createdSegmentIds: string[] = [];

  after(async () => {
    if (createdSegmentIds.length > 0) {
      await db.customerSegment.deleteMany({ where: { id: { in: createdSegmentIds } } }).catch(() => {});
    }
    if (createdSubscriberIds.length > 0) {
      await db.newsletterSubscriber.deleteMany({ where: { id: { in: createdSubscriberIds } } }).catch(() => {});
    }
  });

  it("F-270: a confirmed subscriber with no name on file resolves with no firstName (not the email local part)", async () => {
    const email = `resolver-noname-${randomUUID()}@example.com`;
    const subscriber = await db.newsletterSubscriber.create({
      data: { email, consentGiven: true, confirmedAt: new Date() },
    });
    createdSubscriberIds.push(subscriber.id);

    const segment = await db.customerSegment.create({
      data: {
        name: `Newsletter segment ${randomUUID()}`,
        slug: `newsletter-segment-${randomUUID()}`,
        criteria: JSON.stringify({ consent: true }),
      },
    });
    createdSegmentIds.push(segment.id);

    const recipients = await resolveSegmentRecipients(segment.id);
    const match = recipients.find((r) => r.email === email);
    assert.ok(match, "expected the confirmed subscriber to be resolved");
    assert.equal(match!.firstName, undefined, "must not fall back to the email local part (e.g. 'resolver-noname-...')");
  });

  it("excludes an unconfirmed or unsubscribed subscriber from the newsletter segment", async () => {
    const unconfirmedEmail = `resolver-unconfirmed-${randomUUID()}@example.com`;
    const unsubscribedEmail = `resolver-unsubscribed-${randomUUID()}@example.com`;
    const [unconfirmed, unsubscribed] = await Promise.all([
      db.newsletterSubscriber.create({ data: { email: unconfirmedEmail, consentGiven: true } }),
      db.newsletterSubscriber.create({
        data: {
          email: unsubscribedEmail,
          consentGiven: true,
          confirmedAt: new Date(),
          unsubscribedAt: new Date(),
        },
      }),
    ]);
    createdSubscriberIds.push(unconfirmed.id, unsubscribed.id);

    const segment = await db.customerSegment.create({
      data: {
        name: `Newsletter exclusion segment ${randomUUID()}`,
        slug: `newsletter-exclusion-segment-${randomUUID()}`,
        criteria: JSON.stringify({ consent: true }),
      },
    });
    createdSegmentIds.push(segment.id);

    const recipients = await resolveSegmentRecipients(segment.id);
    assert.ok(!recipients.some((r) => r.email === unconfirmedEmail));
    assert.ok(!recipients.some((r) => r.email === unsubscribedEmail));
  });
});
