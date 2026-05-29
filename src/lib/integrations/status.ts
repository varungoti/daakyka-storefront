export type ProviderStatus = "configured" | "missing" | "disabled";

export interface IntegrationStatus {
  provider: string;
  label: string;
  status: ProviderStatus;
  hint: string;
}

export function getIntegrationStatuses(): IntegrationStatus[] {
  return [
    {
      provider: "SHOPIFY",
      label: "Shopify Storefront",
      status: process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN &&
        process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_ACCESS_TOKEN
        ? "configured"
        : "missing",
      hint: "Product catalog and checkout",
    },
    {
      provider: "BREVO",
      label: "Brevo Email",
      status: process.env.BREVO_API_KEY ? "configured" : "missing",
      hint: "Transactional and campaign email",
    },
    {
      provider: "WATI",
      label: "WATI WhatsApp",
      status: process.env.WATI_API_KEY ? "configured" : "missing",
      hint: "WhatsApp business messaging",
    },
    {
      provider: "HERMES",
      label: "Hermes Agent",
      status:
        process.env.HERMES_RUNTIME_INLINE === "1" ||
        process.env.HERMES_LOCAL_URL ||
        process.env.HERMES_API_URL
          ? "configured"
          : "missing",
      hint: "Vercel inline runtime, HERMES_LOCAL_URL, or external HERMES_API_URL",
    },
  ];
}

export function isProviderConfigured(provider: string): boolean {
  return getIntegrationStatuses().some(
    (item) => item.provider === provider && item.status === "configured",
  );
}
