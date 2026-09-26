/**
 * F-052 fix: paths whose `generateMetadata()` actually reads
 * `getSeoOverrideForPath()` (src/lib/seo/records.ts) — see src/app/page.tsx
 * and src/app/shop/page.tsx. Every other SEO override is accepted by the
 * API and stored, but has no live storefront read path, which used to
 * mislead admins into thinking a saved override for e.g. "/bulk-orders" had
 * taken effect.
 *
 * Kept in its own file, with zero other imports, so a Client Component
 * (src/components/admin/seo-record-form.tsx) can import it directly without
 * pulling in records.ts's Prisma/DB dependency into the client bundle.
 */
export const WIRED_SEO_PATHS = ["/", "/shop"] as const;

export function isWiredSeoPath(path: string): boolean {
  return (WIRED_SEO_PATHS as readonly string[]).includes(path);
}
