import { db } from "@/lib/db";
import { isProviderConfigured } from "@/lib/integrations/status";

// Shopify's optional orders webhook uses its secret directly; it has no
// enabled flag to toggle in the storefront.
export type IntegrationProviderName = "BREVO" | "WATI" | "HERMES";

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

  if (!(await isProviderConfigured(provider))) return false;

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

/**
 * F-267: saving a Brevo credential through the admin UI never touched
 * `IntegrationSetting.enabled` — `isIntegrationEnabled("BREVO")` also
 * requires that flag, and prisma/seed.ts seeds every provider disabled, so
 * an admin who pasted a working API key and a From Email still had every
 * email silently stay in stub mode until they separately found and
 * clicked the unrelated "Disabled — click to enable" pill elsewhere on the
 * integrations page. Once BOTH credentials Brevo actually needs to send
 * (an API key and a From Email) are present *for the first time*, treat
 * that as the admin's intent to turn email on.
 *
 * Deliberately narrow — `wasAlreadyConfigured` must be false — so
 * re-saving an already-configured field (e.g. fixing a typo in an
 * existing key) never re-enables an integration an admin explicitly
 * turned back off after it was already fully configured. Returns whether
 * it actually flipped the flag, so the caller can reflect that back to
 * the admin instead of them discovering it separately.
 */
export async function maybeAutoEnableBrevo(params: {
  wasAlreadyConfigured: boolean;
  otherFieldConfigured: boolean;
}): Promise<boolean> {
  if (params.wasAlreadyConfigured || !params.otherFieldConfigured) return false;

  const setting = await db.integrationSetting.findUnique({ where: { provider: "BREVO" } });
  if (setting?.enabled) return false;

  await setIntegrationEnabled("BREVO", true);
  return true;
}
