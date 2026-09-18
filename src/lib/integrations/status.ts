import { getCredential } from "@/lib/integrations/credential-store";
import { isRazorpayConfigured } from "@/lib/payments/razorpay";

export type ProviderStatus = "configured" | "missing" | "disabled";
export type CredentialSource = "database" | "env";

export interface IntegrationStatus {
  provider: string;
  label: string;
  status: ProviderStatus;
  hint: string;
  /** Where a "configured" status came from — unset when missing. */
  source?: CredentialSource;
}

async function brevoSource(): Promise<CredentialSource | null> {
  if (await getCredential("BREVO", "API_KEY")) return "database";
  if (process.env.BREVO_API_KEY) return "env";
  return null;
}

async function razorpaySource(): Promise<CredentialSource | null> {
  if (!(await isRazorpayConfigured())) return null;
  return (await getCredential("RAZORPAY", "KEY_ID")) ? "database" : "env";
}

export async function getIntegrationStatuses(): Promise<IntegrationStatus[]> {
  const [brevo, razorpay] = await Promise.all([brevoSource(), razorpaySource()]);

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
      status: brevo ? "configured" : "missing",
      hint: "Transactional and campaign email",
      source: brevo ?? undefined,
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
    {
      provider: "RAZORPAY",
      label: "Razorpay Payments",
      status: razorpay ? "configured" : "missing",
      hint: "Online checkout payment capture",
      source: razorpay ?? undefined,
    },
  ];
}

export async function isProviderConfigured(provider: string): Promise<boolean> {
  return (await getIntegrationStatuses()).some(
    (item) => item.provider === provider && item.status === "configured",
  );
}
