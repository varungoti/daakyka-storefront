import { db } from "@/lib/db";
import { isProviderConfigured } from "@/lib/integrations/status";

export type IntegrationProviderName = "SHOPIFY" | "BREVO" | "WATI" | "HERMES";

export async function isIntegrationEnabled(
  provider: IntegrationProviderName,
): Promise<boolean> {
  if (
    provider === "HERMES" &&
    (process.env.HERMES_LOCAL_URL || process.env.HERMES_RUNTIME_INLINE === "1")
  ) {
    const setting = await db.integrationSetting.findUnique({ where: { provider } });
    if (!setting) return true;
    return setting.enabled;
  }

  if (!isProviderConfigured(provider)) return false;

  const setting = await db.integrationSetting.findUnique({
    where: { provider },
  });

  if (!setting) return true;
  return setting.enabled;
}

export async function setIntegrationEnabled(
  provider: IntegrationProviderName,
  enabled: boolean,
): Promise<void> {
  await db.integrationSetting.upsert({
    where: { provider },
    update: { enabled },
    create: { provider, enabled, config: "{}" },
  });
}
