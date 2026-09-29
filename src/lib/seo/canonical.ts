/**
 * Builds the `alternates.canonical` value for a page's `Metadata` export.
 *
 * Paths are relative and resolved against the root `metadataBase` set in
 * `src/app/layout.tsx` (`NEXT_PUBLIC_SITE_URL`, falling back to
 * `https://daakyka.com`), so callers never need to know the full origin.
 * Passing the bare path (no query string) means pages with filterable
 * query params (e.g. `/shop?category=scrubs`) always canonicalize to the
 * same clean URL, which is what we want — the query-string variants are
 * the same content, not distinct pages, for search engines.
 */
export function canonicalPath(path: string): string {
  if (path === "" || path === "/") return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * release-hardening F-101: /category/for-hospitals, /category/school-uniforms
 * and /category/kids-wear render the exact same product list as the
 * section landing pages at /for-hospitals, /school-uniforms and
 * /kids-wear (see src/app/for-hospitals/page.tsx and its two siblings) —
 * both used to self-canonicalize, so the same listing published two
 * "canonical" URLs. One canonical URL per section: the landing page,
 * since that's what the top nav actually links to. Shared here so
 * src/app/category/[slug]/page.tsx (canonical) and src/app/sitemap.ts
 * (listing) can't drift apart on which slugs this applies to.
 */
export const SECTION_LANDING_PATH_BY_CATEGORY_SLUG: Record<string, string> = {
  "for-hospitals": "/for-hospitals",
  "school-uniforms": "/school-uniforms",
  "kids-wear": "/kids-wear",
};
