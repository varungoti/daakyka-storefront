import { AccountNav } from "@/components/account/account-nav";
import { PageContentSection, PageHeroBand } from "@/components/ui/page-shell";
import { SectionHeading } from "@/components/ui/section-heading";
import { getCustomerSession } from "@/lib/customer-auth/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "My Account",
  description: "Manage your DAAKYKA Apparels orders, addresses, reviews, and profile.",
};

/**
 * Release-hardening item 1 (F4 — see docs/audit-2026-09-19/storefront-ux.md
 * and the "Bookmarkable account sections" row of its Shopify parity table):
 * single auth gate for every real account route — orders, the order
 * detail page, addresses, reviews, wishlist, and profile — replacing the
 * old single `/account` page that held all five as client-side tab state
 * (src/components/account/account-tabs.tsx).
 *
 * `(dashboard)` is a Next.js 16 route group (folder name in parentheses):
 * it adds a shared layout to every page nested under it without adding a
 * path segment to the URL, so /account/orders, /account/addresses, etc.
 * all render inside this layout while staying at their own real path —
 * see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route-groups.md.
 * The five public auth pages (login, register, forgot-password,
 * reset-password, verify-email) are siblings *outside* this group under
 * src/app/account/, so they're never wrapped in this check — a
 * logged-out visitor must still be able to reach /account/login.
 *
 * This mirrors src/app/admin/(panel)/layout.tsx's proven pattern: a
 * layout that calls redirect() runs before any nested page renders (a
 * Next.js layout's own render must complete — including any redirect it
 * throws — before its `children` page is invoked), so this one check
 * structurally protects every current and future page nested here; a new
 * page added under this group can't accidentally ship without auth
 * protection the way a per-page-only check could be forgotten.
 *
 * Each page still calls getCustomerSession() itself too — not for
 * gating (this layout already guarantees a session exists by the time
 * any child renders) but because each page needs the resolved
 * customer id for its own scoped query (their orders, their addresses,
 * etc.) — see node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md,
 * "Reusing data with React.cache": Next.js layouts can't pass fetched
 * data down to a page as props, so each Server Component that needs the
 * session fetches it directly.
 *
 * Client-side tab-switching feel: this layout (including <AccountNav>)
 * is shared UI that Next.js keeps mounted across navigations between the
 * pages nested under it — see linking-and-navigating.md's
 * "Client-side transitions" section — so moving between sections is a
 * fast in-place update, not a full page reload, without any extra
 * client-state plumbing.
 */
export default async function AccountDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getCustomerSession();
  if (!session) {
    redirect("/account/login?returnTo=/account");
  }

  return (
    <>
      <PageHeroBand innerClassName="max-w-2xl text-center">
        <SectionHeading
          eyebrow="Account"
          title={`Welcome back, ${session.name.split(" ")[0]}`}
          description="Manage your orders, addresses, reviews, and profile."
          align="center"
          titleAs="h1"
        />
      </PageHeroBand>
      <PageContentSection>
        <AccountNav />
        <div className="mt-8">{children}</div>
      </PageContentSection>
    </>
  );
}
