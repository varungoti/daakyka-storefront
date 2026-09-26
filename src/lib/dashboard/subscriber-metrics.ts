import { db } from "@/lib/db";

/**
 * F-153: "Newsletter Subscribers" used to be a bare `db.newsletterSubscriber
 * .count()` with no filter, so it included every double-opt-in row that
 * was never confirmed (`confirmedAt: null` — see
 * src/lib/engagement/newsletter.ts) and anyone who later unsubscribed.
 * The actual campaign audience already excludes both
 * (src/lib/engagement/segment-resolver.ts's `marketingConsentFilter`
 * requires `consentGiven`, a non-null `confirmedAt`, and no
 * `unsubscribedAt`) — this mirrors that same filter's shape so the
 * dashboard number matches who a campaign would actually reach, instead
 * of overstating it.
 */
export interface SubscriberCounts {
  /** Confirmed, still-subscribed rows — the real marketing audience. */
  active: number;
  /** Rows still waiting on the confirmation-link click. */
  pending: number;
}

export async function getSubscriberCounts(): Promise<SubscriberCounts> {
  const [active, pending] = await Promise.all([
    db.newsletterSubscriber.count({
      where: { consentGiven: true, confirmedAt: { not: null }, unsubscribedAt: null },
    }),
    db.newsletterSubscriber.count({
      where: { confirmedAt: null, unsubscribedAt: null },
    }),
  ]);

  return { active, pending };
}
