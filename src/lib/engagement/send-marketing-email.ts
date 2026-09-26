import { db } from "@/lib/db";
import { sendEmail, type SendEmailResult } from "@/lib/engagement/providers/email";
import { buildUnsubscribeApiUrl, buildUnsubscribeUrl } from "@/lib/engagement/unsubscribe";

export interface SendMarketingEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export type SendMarketingEmailResult =
  | SendEmailResult
  | { ok: false; provider: "skipped"; error: string };

/**
 * The ONLY path campaign-dispatcher.ts and journey-engine.ts should use to
 * send a marketing (non-transactional) email — both were refactored off
 * calling providers/email.ts's sendEmail() directly. It:
 *
 *  1. F-071/F-072: refuses to send to anyone who isn't a confirmed,
 *     consenting, not-unsubscribed NewsletterSubscriber. This is the same
 *     `marketingConsentFilter` segment-resolver.ts applies when building a
 *     campaign's recipient list, re-checked here as the last gate before an
 *     actual send — journeys enrol well ahead of time (an unsubscribe, or a
 *     recipient that was never a real subscriber to begin with, must still
 *     stop the next queued step), and this function has callers beyond the
 *     segment resolver (journey-engine.ts) that never went through it.
 *  2. Appends an unsubscribe footer (every marketing email must offer one)
 *     plus RFC 8058 List-Unsubscribe / List-Unsubscribe-Post headers built
 *     from that subscriber's token, so a mail client can offer a true
 *     one-click unsubscribe that POSTs straight to /api/unsubscribe.
 *
 * Transactional email (order confirmations, review requests, account
 * verification/reset) must NOT go through this — call sendEmail directly,
 * as src/lib/orders/notify.ts and src/lib/customer-auth/mailer.ts already
 * do.
 *
 * Before this gate existed, a recipient with no NewsletterSubscriber row —
 * e.g. a BulkOrderLead whose only "consent" was agreeing to be contacted
 * about their own enquiry, or an address a public API enrolled in a
 * journey with no consent at all — still got mail, with only a plain-text
 * line and no way to opt out. Refusing to send is the fix: there is no
 * other opt-out record in this schema to build a real unsubscribe link
 * from, so an address that was never actually opted in must never receive
 * marketing email at all rather than receive one with no way out.
 */
export async function sendMarketingEmail(
  input: SendMarketingEmailInput,
): Promise<SendMarketingEmailResult> {
  const email = input.to.toLowerCase();
  const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });

  if (!subscriber || !subscriber.consentGiven || !subscriber.confirmedAt || subscriber.unsubscribedAt) {
    return { ok: false, provider: "skipped", error: "No confirmed marketing opt-in" };
  }

  const unsubscribeUrl = buildUnsubscribeUrl(subscriber.unsubscribeToken);
  const footerHtml = `<p style="margin-top:24px;font-size:12px;color:#888888;">You're receiving this because you subscribed to DAAKYKA Apparels updates. <a href="${unsubscribeUrl}">Unsubscribe</a></p>`;
  const footerText = `\n\nUnsubscribe: ${unsubscribeUrl}`;

  const headers = {
    "List-Unsubscribe": `<${buildUnsubscribeApiUrl(subscriber.unsubscribeToken)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };

  return sendEmail({
    to: input.to,
    subject: input.subject,
    html: `${input.html}${footerHtml}`,
    text: `${input.text ?? input.html.replace(/<[^>]+>/g, "")}${footerText}`,
    headers,
  });
}
