import { htmlToText } from "@/lib/email/html";
import { getCredential } from "@/lib/integrations/credential-store";
import { isIntegrationEnabled } from "@/lib/integrations/enabled";
import { getSetting } from "@/lib/settings";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** engagement_compliance: optional custom headers (e.g. RFC 8058
   * List-Unsubscribe / List-Unsubscribe-Post) — Brevo's transactional email
   * API accepts an arbitrary `headers` object, so this passes straight
   * through. Only set by sendMarketingEmail(); transactional callers
   * (customer-auth, order notify) don't need it and leave it undefined. */
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  ok: boolean;
  provider: "brevo" | "stub";
  messageId?: string;
  error?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  if (!(await isIntegrationEnabled("BREVO"))) {
    return {
      ok: false,
      provider: "stub",
      // F-264 fix: this used to say "queued in stub mode", which is only
      // true for a caller that actually persists the attempt (see
      // sendTransactionalEmail in outbox.ts). Callers that send directly
      // (sendMarketingEmail, and the pre-fix newsletter confirmation email)
      // queue nothing — nothing is retried, so the message must not claim
      // otherwise.
      error: "Brevo not enabled or not configured — email not sent",
    };
  }

  // isIntegrationEnabled("BREVO") above already confirmed a key exists
  // somewhere (DB or env) — resolve the same way here, DB-first.
  const apiKey = (await getCredential("BREVO", "API_KEY")) ?? process.env.BREVO_API_KEY!;
  const fromEmail =
    (await getCredential("BREVO", "FROM_EMAIL")) ?? process.env.BREVO_FROM_EMAIL ?? "noreply@daakyka.com";
  const fromName = process.env.BREVO_FROM_NAME ?? "DAAKYKA Apparels";
  // F-351 fix: sender-only meant every customer reply to a transactional or
  // marketing email landed on noreply@ — nobody monitors that inbox, so
  // replies (and any bounce-back from a mail client that ignores the
  // no-reply convention) silently went nowhere. `contact.email` is the
  // one admin-editable support address the rest of the site already
  // publishes (see src/lib/settings/index.ts), so this never invents an
  // address — it reuses whichever one the owner has actually set.
  const replyToEmail = await getSetting("contact.email");

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: fromEmail, name: fromName },
        to: [{ email: input.to }],
        ...(replyToEmail ? { replyTo: { email: replyToEmail } } : {}),
        subject: input.subject,
        htmlContent: input.html,
        // F-041: the old `html.replace(/<[^>]+>/g, "")` fallback dropped every
        // link and ran sentences together; htmlToText keeps `label (url)`.
        textContent: input.text ?? htmlToText(input.html),
        ...(input.headers ? { headers: input.headers } : {}),
      }),
      // F-269 fix: an unbounded fetch here used to let a slow/hung Brevo
      // endpoint hold checkout, payment-verify and registration responses
      // open indefinitely (those routes await sendTransactionalEmail before
      // responding). A timeout turns that into a normal PENDING outbox row
      // (see sendTransactionalEmail in outbox.ts) instead of an indefinite
      // hang.
      signal: AbortSignal.timeout(8_000),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, provider: "brevo", error: body || response.statusText };
    }

    const data = (await response.json()) as { messageId?: string };
    return { ok: true, provider: "brevo", messageId: data.messageId };
  } catch (error) {
    return {
      ok: false,
      provider: "brevo",
      error: error instanceof Error ? error.message : "Email send failed",
    };
  }
}
