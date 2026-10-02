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
 *
 * "Pending" therefore has two shapes the status must both report: a brand-new
 * subscriber who has not clicked yet, and a previously-unsubscribed address
 * whose re-subscribe request is waiting on its fresh confirmation link
 * (unsubscribedAt stays set until that click, so it cannot be told apart by
 * the timestamps alone — an outstanding confirmToken is what marks it).
 * Reporting the second as "unsubscribed" left the shopper with no sign their
 * request had worked, and every further click minted another link and
 * invalidated the one already in their inbox.
 */

export type MarketingStatus = "subscribed" | "pending" | "unsubscribed" | "none";

export async function getMarketingStatus(email: string): Promise<MarketingStatus> {
  const row = await db.newsletterSubscriber.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { confirmedAt: true, unsubscribedAt: true, confirmToken: true },
  });
  if (!row) return "none";
  if (row.unsubscribedAt) return row.confirmToken ? "pending" : "unsubscribed";
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
    // Also cancels a re-subscribe request still waiting on its confirmation
    // link (unsubscribeByToken leaves an already-unsubscribed row alone), so
    // the status settles on "unsubscribed" and the old link stops working.
    await db.newsletterSubscriber.updateMany({ where: { email: normalised }, data: { confirmToken: null } });
    return "unsubscribed";
  }
  await subscribeToNewsletter({ email: normalised, source: "account" });
  return getMarketingStatus(normalised);
}
