import { CheckoutPageContent } from "@/components/checkout/checkout-page-content";
import { db } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Complete your DAAKYKA Apparels order securely.",
  robots: { index: false, follow: false },
};

/** F-134: a signed-in customer's saved address, shaped for the checkout
 * form's own field names (postalCode -> pincode) rather than the DB
 * column names — see CheckoutPageContent's CheckoutAddressPrefill. */
export interface CheckoutSavedAddress {
  id: string;
  label: string | null;
  recipientName: string | null;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
  country: string;
  phone: string | null;
  isDefault: boolean;
}

interface CheckoutCustomerHint {
  email?: string;
  name?: string;
  phone?: string;
  /** Default address first (see the query below) — the checkout page
   * prefills from addresses[0] and offers the rest in a picker. */
  addresses?: CheckoutSavedAddress[];
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
 * F-134: also prefills the customer's saved addresses (default first) and
 * phone — both DB reads happen inside the same try/catch as the session
 * lookup, so any failure here still falls back to plain guest checkout
 * rather than a broken page.
 */
async function getCheckoutCustomerHint(): Promise<CheckoutCustomerHint> {
  try {
    const sessionModule = await import("@/lib/customer-auth/session").catch(() => null);
    if (!sessionModule || typeof sessionModule.getCustomerSession !== "function") return {};
    const session = await sessionModule.getCustomerSession();
    if (!session || typeof session !== "object") return {};
    const { id, email, name } = session as { id?: unknown; email?: unknown; name?: unknown };
    const hint: CheckoutCustomerHint = {
      email: typeof email === "string" ? email : undefined,
      name: typeof name === "string" ? name : undefined,
    };
    if (typeof id !== "string") return hint;

    const [customer, addresses] = await Promise.all([
      db.customer.findUnique({ where: { id }, select: { phone: true } }),
      db.customerAddress.findMany({
        where: { customerId: id },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        take: 10,
      }),
    ]);

    hint.phone = customer?.phone ?? undefined;
    hint.addresses = addresses.map((address) => ({
      id: address.id,
      label: address.label,
      recipientName: address.recipientName,
      line1: address.line1,
      line2: address.line2,
      city: address.city,
      state: address.state,
      pincode: address.postalCode,
      country: address.country,
      phone: address.phone,
      isDefault: address.isDefault,
    }));
    return hint;
  } catch {
    return {};
  }
}

export default async function CheckoutPage() {
  // F-115: the checkout page previously said "Shipping is calculated at
  // the next step" with no next step. These are the same two settings
  // createOrderFromCart uses (src/lib/orders/create-order.ts), read here
  // so the page can show a real Shipping/Total before Place Order instead
  // of just at confirmation — same pattern as products/[handle]/page.tsx.
  const [customerHint, flatRate, freeAbove] = await Promise.all([
    getCheckoutCustomerHint(),
    getSetting("shipping.flatRate"),
    getSetting("shipping.freeAbove"),
  ]);
  return (
    <CheckoutPageContent
      customerHint={customerHint}
      shipping={{ flatRate, freeAbove }}
    />
  );
}
