import { AddressesTab } from "@/components/account/account-tabs";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { db } from "@/lib/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "My Addresses" };

/**
 * Release-hardening item 1 (F4). Auth is enforced by
 * src/app/account/(dashboard)/layout.tsx; the session is re-read here
 * only to scope this query to the caller's own addresses (same query
 * the old /account page ran before this route existed).
 */
export default async function AccountAddressesPage() {
  const session = await getCustomerSession();
  if (!session) redirect("/account/login?returnTo=/account/addresses");

  const addresses = await db.customerAddress.findMany({
    where: { customerId: session.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return (
    <AddressesTab
      initialAddresses={addresses.map((address) => ({
        id: address.id,
        label: address.label,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        state: address.state,
        postalCode: address.postalCode,
        country: address.country,
        phone: address.phone,
        isDefault: address.isDefault,
      }))}
    />
  );
}
