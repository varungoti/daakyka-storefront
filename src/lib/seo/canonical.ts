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
