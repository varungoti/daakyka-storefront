import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";

/**
 * Phase E2: the storefront's read path for manifest-declared site images
 * (see src/data/media/image-manifest.ts). Mirrors the exact
 * graceful-fallback caching pattern used by src/lib/settings/index.ts
 * (`getSetting`): cached per-slot with Next's data cache, tagged
 * `MEDIA_CACHE_TAG` so a write (upload or AI generation) can invalidate
 * every cached slot at once via `revalidateTag` — see
 * src/lib/media/store.ts's `saveMediaAsset`, which is the one place both
 * the admin upload route and the AI generation flow create/replace a
 * slotted `MediaAsset`.
 *
 * Never throws: a missing slot, a DB error, or being called outside a
 * real Next.js request/build scope (unit tests, standalone scripts) all
 * resolve to `null`, and callers are expected to render their own neutral
 * placeholder in that case (see `placeholderForAspect` in the manifest).
 */

export const MEDIA_CACHE_TAG = "media";

export interface SiteImage {
  url: string;
  alt: string;
}

async function readSiteImageFromDb(slot: string): Promise<SiteImage | null> {
  try {
    const asset = await db.mediaAsset.findUnique({ where: { slot } });
    if (!asset) return null;
    return { url: asset.url, alt: asset.alt ?? "" };
  } catch {
    // DB unavailable (e.g. at build time, or a local script without a
    // running Postgres) — callers fall back to a placeholder either way.
    return null;
  }
}

// Cached per-slot with Next's data cache, tagged "media" so any write to a
// slotted MediaAsset can invalidate every cached slot at once.
const cachedReadSiteImage = unstable_cache(
  async (slot: string) => readSiteImageFromDb(slot),
  ["site-image"],
  { tags: [MEDIA_CACHE_TAG] },
);

/** Looks up the current image for a manifest slot, or `null` when nothing
 * has been generated/uploaded for it yet. */
export async function getSiteImage(slot: string): Promise<SiteImage | null> {
  try {
    return await cachedReadSiteImage(slot);
  } catch {
    // unstable_cache needs Next's incremental cache / request store, which
    // isn't present outside an actual Next server (unit tests, scripts,
    // etc). Fall back to an uncached read rather than throwing.
    return readSiteImageFromDb(slot);
  }
}

/** Batch variant for a page that needs several slots at once (e.g. the
 * homepage hero + tiles) — resolves every slot in parallel, still via the
 * same per-slot cache entries. */
export async function getSiteImages(
  slots: readonly string[],
): Promise<Record<string, SiteImage | null>> {
  const entries = await Promise.all(
    slots.map(async (slot) => [slot, await getSiteImage(slot)] as const),
  );
  return Object.fromEntries(entries);
}
