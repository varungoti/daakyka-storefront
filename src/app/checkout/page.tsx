import { CheckoutPageContent } from "@/components/checkout/checkout-page-content";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Complete your DAAKYKA Apparels order securely.",
  robots: { index: false, follow: false },
};

interface CheckoutCustomerHint {
  email?: string;
  name?: string;
}

/**
 * Cosmetic-only prefill for a logged-in customer, once D1 (customer
 * accounts) has landed — see src/lib/customer-auth/session.ts. This is
 * purely a UX convenience (pre-filling the contact fields); it carries no
 * trust, and the checkout API route does its own independent, equally
 * best-effort session lookup server-side to link the order to the
 * customer (see getOptionalCustomerId in
 * src/app/api/checkout/route.ts) — never from a client-supplied field.
 *
 * A missing module, a different export shape, or a lookup failure all
 * just fall back to `{}` (plain guest checkout) — this must never block
 * or crash the checkout page.
 *
 * TODO: once D1's saved-addresses API is stable, also prefill the
 * customer's default CustomerAddress here.
 */
async function getCheckoutCustomerHint(): Promise<CheckoutCustomerHint> {
  try {
    const sessionModule = await import("@/lib/customer-auth/session").catch(() => null);
    if (!sessionModule || typeof sessionModule.getCustomerSession !== "function") return {};
    const session = await sessionModule.getCustomerSession();
    if (!session || typeof session !== "object") return {};
    const { email, name } = session as { email?: unknown; name?: unknown };
    return {
      email: typeof email === "string" ? email : undefined,
      name: typeof name === "string" ? name : undefined,
    };
  } catch {
    return {};
  }
}

export default async function CheckoutPage() {
  const customerHint = await getCheckoutCustomerHint();
  return <CheckoutPageContent customerHint={customerHint} />;
}
