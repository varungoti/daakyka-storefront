"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Release-hardening item 1 (F4 — see docs/audit-2026-09-19/storefront-ux.md):
 * replaces account-tabs.tsx's old useState tab switcher with real
 * <Link>-based navigation between /account/{orders,addresses,reviews,
 * wishlist,profile}. Rendered once from the shared
 * src/app/account/(dashboard)/layout.tsx, so it persists across section
 * navigations instead of remounting — Next.js keeps shared layout output
 * mounted across a client-side transition between sibling pages (see
 * node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md,
 * "Client-side transitions": "Keeping any shared layouts and UI"), which
 * is what keeps tab-switching feeling instant instead of like a full
 * page reload.
 *
 * Same visual styling as the old tab buttons (rounded-full pill,
 * flex-wrap for mobile) so this is a routing change, not a redesign.
 */
const SECTIONS = [
  { href: "/account/orders", label: "Orders" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/reviews", label: "Reviews" },
  { href: "/account/wishlist", label: "Wishlist" },
  { href: "/account/profile", label: "Profile" },
] as const;

export function AccountNav() {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap gap-2 border-b border-border pb-2">
      {SECTIONS.map((section) => {
        // /account/orders/[number] (order detail) should still highlight
        // the "Orders" section as active.
        const active = pathname === section.href || pathname?.startsWith(`${section.href}/`);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-2 text-sm font-semibold transition",
              active ? "bg-brand text-white" : "text-ink hover:bg-lilac/40",
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </div>
  );
}
