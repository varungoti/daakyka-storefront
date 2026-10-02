import { SEO_GUIDE_SLUGS } from "@/data/seo-guide-slugs";

/**
 * F-052 fix: paths whose `generateMetadata()` actually reads an admin override
 * (`getSeoOverrideForPath()` / `withSeoOverride()` in src/lib/seo/records.ts).
 * Every other SEO override is accepted by the API and stored, but has no live
 * storefront read path, which used to mislead admins into thinking a saved
 * override for e.g. "/size-guide" had taken effect.
 *
 * The first six are the home, shop and the lead/brand pages the owner is most
 * likely to retitle (src/app/page.tsx, shop/page.tsx, bulk-orders/page.tsx,
 * about/page.tsx, contact/page.tsx, guides/page.tsx); each guide is wired
 * through src/app/guides/[slug]/page.tsx. Adding a path here without wiring
 * its page is the bug this list exists to prevent — src/lib/seo/
 * page-metadata.test.ts checks the pages against it.
 *
 * Kept free of Prisma/DB imports (only a small data file), so a Client
 * Component (src/components/admin/seo-record-form.tsx) can import it directly
 * without pulling records.ts's database dependency into the client bundle.
 */
export const STATIC_WIRED_SEO_PATHS = ["/", "/shop", "/bulk-orders", "/about", "/contact", "/guides"] as const;

export const WIRED_SEO_PATHS: readonly string[] = [
  ...STATIC_WIRED_SEO_PATHS,
  ...SEO_GUIDE_SLUGS.map((slug) => `/guides/${slug}`),
];

const WIRED_SEO_PATH_SET: ReadonlySet<string> = new Set(WIRED_SEO_PATHS);

export function isWiredSeoPath(path: string): boolean {
  return WIRED_SEO_PATH_SET.has(path);
}
