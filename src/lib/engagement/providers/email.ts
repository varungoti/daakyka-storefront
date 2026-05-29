import { isIntegrationEnabled } from "@/lib/integrations/enabled";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
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

  const apiKey = process.env.BREVO_API_KEY!;
  const fromEmail = process.env.BREVO_FROM_EMAIL ?? "noreply@daakyka.com";
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
