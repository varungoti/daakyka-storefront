import { WishlistTab } from "@/components/account/account-tabs";
import { getCustomerSession } from "@/lib/customer-auth/session";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "My Wishlist" };

/**
 * Release-hardening item 1 (F4). Auth is enforced by
 * src/app/account/(dashboard)/layout.tsx. <WishlistTab> itself reads
 * from the global, localStorage-backed WishlistProvider
 * (src/context/wishlist-provider.tsx, mounted in the root layout) —
 * unchanged from before this route existed. Per-device, not
 * server-synced: the account UI's own copy already says so ("Syncing
 * your wishlist to your account is coming soon"), and despite a
 * `WishlistItem` table existing in prisma/schema.prisma, nothing in this
 * codebase reads or writes it today — there is no actual
 * wishlist-merge-on-login behavior to preserve beyond this
 * already-existing local, non-syncing display, which this route keeps
 * exactly as-is.
 */
export default async function AccountWishlistPage() {
  const session = await getCustomerSession();
  if (!session) redirect("/account/login?returnTo=/account/wishlist");

  return <WishlistTab />;
}
