import { redirect } from "next/navigation";

/**
 * Release-hardening item 1 (F4): `/account` itself used to render the
 * whole tab dashboard with "Orders" as the default tab
 * (src/components/account/account-tabs.tsx's old `useState<Tab>("Orders")`
 * default). Now that each section is its own route, `/account` simply
 * forwards to the same default section — every existing link that points
 * at plain `/account` (header nav, the post-login `returnTo` default in
 * src/lib/customer-auth/return-to.ts, verify-email's "Back to account"
 * link) keeps working unchanged, it just takes one extra redirect to a
 * real, bookmarkable URL instead of landing on client-side tab state.
 */
export default function AccountIndexPage() {
  redirect("/account/orders");
}
