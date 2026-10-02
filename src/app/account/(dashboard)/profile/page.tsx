import { ProfileTab } from "@/components/account/account-tabs";
import { PrivacyControls } from "@/components/account/privacy-controls";
import { getCustomerSession } from "@/lib/customer-auth/session";
import { db } from "@/lib/db";
import { getMarketingStatus } from "@/lib/privacy/preferences";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "My Profile" };

/**
 * Release-hardening item 1 (F4). Auth is enforced by
 * src/app/account/(dashboard)/layout.tsx; the session is re-read here
 * only to load this customer's own profile fields (same query the old
 * /account page ran before this route existed). <ProfileTab> also
 * renders the sign-out button, unchanged.
 */
export default async function AccountProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ emailChange?: string | string[] }>;
}) {
  const session = await getCustomerSession();
  if (!session) redirect("/account/login?returnTo=/account/profile");

  const customer = await db.customer.findUnique({
    where: { id: session.id },
    select: { id: true, email: true, name: true, phone: true, emailVerifiedAt: true },
  });
  if (!customer) redirect("/account/login?returnTo=/account/profile");

  const [marketing, { emailChange }] = await Promise.all([getMarketingStatus(customer.email), searchParams]);

  return (
    <ProfileTab
      customer={{
        id: customer.id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        emailVerified: Boolean(customer.emailVerifiedAt),
      }}
    >
      <PrivacyControls
        email={customer.email}
        marketing={marketing}
        emailChangeNotice={emailChange === "invalid" ? "invalid" : undefined}
      />
    </ProfileTab>
  );
}
