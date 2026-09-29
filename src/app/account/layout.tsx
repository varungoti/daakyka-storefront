import type { Metadata } from "next";

/**
 * release-hardening F-045: every /account page (the (dashboard) group —
 * orders/addresses/reviews/wishlist/profile — plus the sibling auth pages:
 * login, register, forgot-password, reset-password, verify-email) rendered
 * with the layout's default `index, follow` robots meta, because none of
 * them set their own. This layout wraps the whole `/account` segment (one
 * level above the `(dashboard)` route group, which only wraps the
 * authenticated pages) so every one of them — including the public auth
 * pages a signed-out visitor can reach — is noindex. Metadata merges
 * per-key, so this doesn't touch the `title`/`description` each page (or
 * the `(dashboard)` layout) already sets.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return children;
}
