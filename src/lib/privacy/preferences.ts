import { db } from "@/lib/db";
import { subscribeToNewsletter } from "@/lib/engagement/newsletter";
import { unsubscribeByToken } from "@/lib/engagement/unsubscribe";

/**
 * F-315: marketing-email consent from inside the account. A token-based
 * unsubscribe already existed (the link in every marketing email), but a
 * signed-in shopper had no way to see or change their consent without
 * finding an old email. These read and write the same NewsletterSubscriber
 * row that link does, so both routes stay in step.
 *
 *  - Turning it OFF is immediate and also cancels any active journey for the
 *    address (unsubscribeByToken does both).
 *  - Turning it ON goes through the ordinary double opt-in (a confirmation
 *    email) — the same rule as the footer form: consent is only recorded once
 *    the mailbox owner confirms (see subscribeToNewsletter, F-050).
 */

export type MarketingStatus = "subscribed" | "pending" | "unsubscribed" | "none";

export async function getMarketingStatus(email: string): Promise<MarketingStatus> {
  const row = await db.newsletterSubscriber.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { confirmedAt: true, unsubscribedAt: true },
  });
  if (!row) return "none";
  if (row.unsubscribedAt) return "unsubscribed";
  return row.confirmedAt ? "subscribed" : "pending";
}

export async function setMarketingPreference(email: string, subscribed: boolean): Promise<MarketingStatus> {
  const normalised = email.trim().toLowerCase();
  if (!subscribed) {
    const row = await db.newsletterSubscriber.findUnique({
      where: { email: normalised },
      select: { unsubscribeToken: true },
    });
    if (!row) return "none";
    await unsubscribeByToken(row.unsubscribeToken);
    return "unsubscribed";
  }
  await subscribeToNewsletter({ email: normalised, source: "account" });
  return getMarketingStatus(normalised);
}
