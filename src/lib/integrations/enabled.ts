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
    // No row means no admin has opted in yet (prisma/seed.ts creates one
    // with enabled: false for every provider, so this is a fallback for
    // that row being missing, not the normal case) — default to
    // disabled rather than silently going live because an API key
    // happens to be present in the environment.
    return setting?.enabled ?? false;
  }

  if (!isProviderConfigured(provider)) return false;

  const setting = await db.integrationSetting.findUnique({
    where: { provider },
  });

  return setting?.enabled ?? false;
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
