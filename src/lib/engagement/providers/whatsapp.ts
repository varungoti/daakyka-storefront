import { isIntegrationEnabled } from "@/lib/integrations/enabled";
import { normalizeWhatsAppPhone } from "@/lib/engagement/whatsapp-consent";

export interface SendWhatsAppInput {
  phone: string;
  message: string;
}

export interface SendWhatsAppTemplateInput {
  phone: string;
  message: string;
  parameters?: string[];
}

export interface SendWhatsAppResult {
  ok: boolean;
  provider: "wati" | "stub";
  messageId?: string;
  error?: string;
}

/** F-266 fix: WATI requires the number with its country code (e.g. a 10-digit
 * Indian mobile becomes 91XXXXXXXXXX) — a bare `\D` strip left "98765 43210"
 * as "9876543210", which WATI reads as a different (or invalid) number.
 * normalizeWhatsAppPhone is shared with the WhatsAppOptIn consent lookup
 * (see whatsapp-consent.ts) so a read and a write of the same number always
 * agree on its key. */
function normalizePhone(phone: string): string | null {
  return normalizeWhatsAppPhone(phone);
}

export async function sendWhatsApp(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  if (!(await isIntegrationEnabled("WATI"))) {
    return {
      ok: false,
      provider: "stub",
      error: "WATI not enabled or not configured — message queued in stub mode",
    };
  }

  const phone = normalizePhone(input.phone);
  if (!phone) {
    return { ok: false, provider: "wati", error: "Invalid WhatsApp number" };
  }

  const apiKey = process.env.WATI_API_KEY!;
  const baseUrl = process.env.WATI_API_URL ?? "https://live-server.wati.io";

  try {
    const response = await fetch(`${baseUrl}/api/v1/sendSessionMessage/${phone}`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messageText: input.message }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, provider: "wati", error: body || response.statusText };
    }

    // F-266 fix: WATI can answer HTTP 200 with `{ result: false, ... }` (e.g.
    // the 24h session window has expired) — that's a real send failure, not
    // a success, and must not be reported as one.
    const data = (await response.json()) as { result?: boolean; messageId?: string; info?: string };
    if (data.result === false) {
      return { ok: false, provider: "wati", error: data.info ?? "WATI rejected the message" };
    }
    return { ok: true, provider: "wati", messageId: data.messageId };
  } catch (error) {
    return {
      ok: false,
      provider: "wati",
      error: error instanceof Error ? error.message : "WhatsApp send failed",
    };
  }
}

/** WATI approved template — required for cold outreach outside 24h session window */
export async function sendWhatsAppTemplate(
  input: SendWhatsAppTemplateInput,
): Promise<SendWhatsAppResult> {
  if (!(await isIntegrationEnabled("WATI"))) {
    return {
      ok: false,
      provider: "stub",
      error: "WATI not enabled or not configured — template queued in stub mode",
    };
  }

  const templateName = process.env.WATI_BROADCAST_TEMPLATE;
  if (!templateName) {
    // F-266 fix: this used to silently fall back to sendWhatsApp (a
    // free-form session message), which WhatsApp rejects outside a 24h
    // customer-initiated window — exactly the failure mode this function
    // exists to avoid for cold outreach. No approved template configured is
    // a real misconfiguration; surface it instead of masking it as a
    // session-message send.
    return {
      ok: false,
      provider: "wati",
      error: "No approved WATI broadcast template configured (WATI_BROADCAST_TEMPLATE)",
    };
  }

  const apiKey = process.env.WATI_API_KEY!;
  const baseUrl = process.env.WATI_API_URL ?? "https://live-server.wati.io";
  const phone = normalizePhone(input.phone);
  if (!phone) {
    return { ok: false, provider: "wati", error: "Invalid WhatsApp number" };
  }
  const broadcastName = process.env.WATI_BROADCAST_NAME ?? "DAAKYKA Campaign";

  try {
    const response = await fetch(
      `${baseUrl}/api/v1/sendTemplateMessage?whatsappNumber=${phone}`,
      {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          template_name: templateName,
          broadcast_name: broadcastName,
          // F-266 fix: each parameter needs its own positional name to
          // match the template's placeholders ({{1}}, {{2}}, ...) — every
          // value being named "1" meant only the first placeholder ever
          // filled correctly.
          parameters: (input.parameters ?? []).map((value, index) => ({
            name: String(index + 1),
            value,
          })),
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, provider: "wati", error: body || response.statusText };
    }

    const data = (await response.json()) as { result?: boolean; messageId?: string; info?: string };
    if (data.result === false) {
      return { ok: false, provider: "wati", error: data.info ?? "WATI rejected the template message" };
    }
    return { ok: true, provider: "wati", messageId: data.messageId };
  } catch (error) {
    return {
      ok: false,
      provider: "wati",
      error: error instanceof Error ? error.message : "WhatsApp template send failed",
    };
  }
}
