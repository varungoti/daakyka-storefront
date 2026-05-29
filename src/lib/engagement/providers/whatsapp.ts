import { isIntegrationEnabled } from "@/lib/integrations/enabled";

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

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export async function sendWhatsApp(input: SendWhatsAppInput): Promise<SendWhatsAppResult> {
  if (!(await isIntegrationEnabled("WATI"))) {
    return {
      ok: false,
      provider: "stub",
      error: "WATI not enabled or not configured — message queued in stub mode",
    };
  }

  const apiKey = process.env.WATI_API_KEY!;
  const baseUrl = process.env.WATI_API_URL ?? "https://live-server.wati.io";
  const phone = normalizePhone(input.phone);

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

    const data = (await response.json()) as { messageId?: string };
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
    return sendWhatsApp({ phone: input.phone, message: input.message });
  }

  const apiKey = process.env.WATI_API_KEY!;
  const baseUrl = process.env.WATI_API_URL ?? "https://live-server.wati.io";
  const phone = normalizePhone(input.phone);
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
          parameters: (input.parameters ?? []).map((value) => ({ name: "1", value })),
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, provider: "wati", error: body || response.statusText };
    }

    const data = (await response.json()) as { messageId?: string };
    return { ok: true, provider: "wati", messageId: data.messageId };
  } catch (error) {
    return {
      ok: false,
      provider: "wati",
      error: error instanceof Error ? error.message : "WhatsApp template send failed",
    };
  }
}
