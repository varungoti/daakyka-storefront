import { NextResponse } from "next/server";
import { logAuditEvent } from "@/lib/auth/audit";
import { requireAdminPermission } from "@/lib/auth/admin-api";
import { setIntegrationEnabled, type IntegrationProviderName } from "@/lib/integrations/enabled";
import { readJsonBody } from "@/lib/security/parse-json-body";
import { z } from "zod";

const schema = z.object({
  enabled: z.boolean(),
});

const providers: IntegrationProviderName[] = ["SHOPIFY", "BREVO", "WATI", "HERMES"];

interface RouteParams {
  params: Promise<{ provider: string }>;
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { session, error } = await requireAdminPermission("integrations:manage");
  if (error) return error;

  const { provider } = await params;
  const normalized = provider.toUpperCase() as IntegrationProviderName;
  if (!providers.includes(normalized)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  const bodyResult = await readJsonBody(request);
  if (!bodyResult.ok) return bodyResult.response;
  const parsed = schema.safeParse(bodyResult.data);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await setIntegrationEnabled(normalized, parsed.data.enabled);

  await logAuditEvent({
    userId: session!.id,
    action: parsed.data.enabled ? "enable" : "disable",
    entity: "integration",
    entityId: normalized,
  });

  return NextResponse.json({ provider: normalized, enabled: parsed.data.enabled });
}
