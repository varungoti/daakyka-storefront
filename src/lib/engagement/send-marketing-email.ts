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
 *  1. Refuses to send to an address that has unsubscribed. The segment
 *     resolver already excludes unsubscribed subscribers from a campaign's
 *     recipient list, but this is the last gate before an actual send —
 *     journeys enroll well ahead of time, and an unsubscribe that lands
 *     mid-journey must still stop the next queued step.
 *  2. Appends an unsubscribe footer (every marketing email must offer one)
 *     plus RFC 8058 List-Unsubscribe / List-Unsubscribe-Post headers when
 *     the recipient has a NewsletterSubscriber row to build a token from,
 *     so a mail client can offer a true one-click unsubscribe that POSTs
 *     straight to /api/unsubscribe.
 *
 * Transactional email (order confirmations, review requests, account
 * verification/reset) must NOT go through this — call sendEmail directly,
 * as src/lib/orders/notify.ts and src/lib/customer-auth/mailer.ts already
 * do.
 *
 * Note: the unsubscribe-token footer/headers only apply when the recipient
 * has a NewsletterSubscriber row (there's no other opt-out record in this
 * schema). A recipient with no such row — e.g. a BulkOrderLead being sent a
 * campaign on the dedicated "bulk_order" segment — still gets a plain-text
 * opt-out line, but can't be checked against `unsubscribedAt` here; that
 * audience's consent is governed by BulkOrderLead.consentGiven, already
 * filtered upstream in segment-resolver.ts.
 */
export async function sendMarketingEmail(
  input: SendMarketingEmailInput,
): Promise<SendMarketingEmailResult> {
  const email = input.to.toLowerCase();
  const subscriber = await db.newsletterSubscriber.findUnique({ where: { email } });

  if (subscriber?.unsubscribedAt) {
    return { ok: false, provider: "skipped", error: "Recipient has unsubscribed" };
  }

  const unsubscribeUrl = subscriber ? buildUnsubscribeUrl(subscriber.unsubscribeToken) : null;
  const footerHtml = unsubscribeUrl
    ? `<p style="margin-top:24px;font-size:12px;color:#888888;">You're receiving this because you subscribed to DAAKYKA Apparels updates. <a href="${unsubscribeUrl}">Unsubscribe</a></p>`
    : `<p style="margin-top:24px;font-size:12px;color:#888888;">You're receiving this email from DAAKYKA Apparels.</p>`;
  const footerText = unsubscribeUrl
    ? `\n\nUnsubscribe: ${unsubscribeUrl}`
    : "\n\nYou're receiving this email from DAAKYKA Apparels.";

  const headers = subscriber
    ? {
        "List-Unsubscribe": `<${buildUnsubscribeApiUrl(subscriber.unsubscribeToken)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      }
    : undefined;

  return sendEmail({
    to: input.to,
    subject: input.subject,
    html: `${input.html}${footerHtml}`,
    text: `${input.text ?? input.html.replace(/<[^>]+>/g, "")}${footerText}`,
    headers,
  });
}
