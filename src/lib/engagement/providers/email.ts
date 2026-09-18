import { getCredential } from "@/lib/integrations/credential-store";
import { isIntegrationEnabled } from "@/lib/integrations/enabled";

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
      error: "Brevo not enabled or not configured — email queued in stub mode",
    };
  }

  // isIntegrationEnabled("BREVO") above already confirmed a key exists
  // somewhere (DB or env) — resolve the same way here, DB-first.
  const apiKey = (await getCredential("BREVO", "API_KEY")) ?? process.env.BREVO_API_KEY!;
  const fromEmail =
    (await getCredential("BREVO", "FROM_EMAIL")) ?? process.env.BREVO_FROM_EMAIL ?? "noreply@daakyka.com";
  const fromName = process.env.BREVO_FROM_NAME ?? "DAAKYKA Apparels";

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
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text ?? input.html.replace(/<[^>]+>/g, ""),
        ...(input.headers ? { headers: input.headers } : {}),
      }),
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
