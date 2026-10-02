import type { Metadata } from "next";

export interface SeoOverride {
  title: string;
  metaDescription: string;
}

/**
 * F-052: lays an admin's SEO override (src/lib/seo/records.ts) over a page's
 * own metadata. Only `title` and `description` are replaced — the canonical,
 * og:url, robots and image the page already declares stay as they are, and
 * Next fills og:title/og:description/twitter:* from the resulting title and
 * description (the root layout deliberately sets none, see src/app/layout.tsx).
 * A blank override field (the form requires both, but a row can predate that)
 * falls back to the page's own value rather than blanking the tag.
 *
 * Pure, so the merge can be unit-tested without a database.
 */
export function mergeSeoOverride(base: Metadata, override: SeoOverride | null): Metadata {
  if (!override) return base;
  const title = override.title.trim();
  const description = override.metaDescription.trim();
  return {
    ...base,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
}
