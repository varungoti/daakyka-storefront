import { CDN_CACHE_TAG, cdnCacheTagForKey, resolveCdnObjectKey } from "@/lib/storage/cdn-key";
import { getObject } from "@/lib/storage/r2";

/**
 * Serves R2-stored media (AI-generated and uploaded product/site images)
 * from this app's own origin instead of requiring the R2 bucket to be
 * publicly readable — see publicUrlForKey() in src/lib/storage/r2.ts.
 * Object keys are UUID-named and never reused (a "replace" writes a new
 * key and leaves the old one for the orphan sweeper to reclaim once
 * nothing references it any more — see saveMediaAsset in
 * src/lib/media/store.ts, F-064/F-356/F-361).
 *
 * F-362 fix: this used to cache a successful response as `immutable` for a
 * full year on the strength of that "keys are never reused" guarantee
 * alone — but a key CAN legitimately stop being servable within that year
 * now that it's actually deleted (a rejected review's photo — see
 * rejectReview in src/lib/reviews/moderate-review.ts — or a swept orphan,
 * scripts/cleanup-orphaned-media.ts). A year-long edge cache meant a
 * rejected photo, or a deleted product's, kept being served from cache
 * long after the R2 object and DB row were gone. `max-age=300` bounds that
 * window to a few minutes: that TTL, not the purge below, is the guarantee.
 *
 * Every response is also tagged (`Vercel-Cache-Tag`, see
 * https://vercel.com/docs/caching/cdn-cache/purge) with a per-object tag
 * plus one shared `cdn-media` tag, which makes it purgeable: the delete
 * path (deleteUnattachedMediaAsset in src/lib/media/store.ts) purges the
 * object's own tag on a best-effort basis, and an operator can purge
 * `cdn-media` from the Vercel dashboard for an emergency takedown.
 * Note `images.minimumCacheTTL` (next.config.ts) is 30 days, so the
 * optimised `/_next/image` variants of a storefront-rendered photo outlive
 * this TTL — those are purged per source image, not by these tags.
 *
 * Traversal/double-decode validation lives in resolveCdnObjectKey() —
 * see that module's doc comment for the F5 fix (double-encoded segments
 * used to pass the guard before decoding into "..").
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key: segments } = await params;

  const key = resolveCdnObjectKey(segments);
  if (key === null) {
    return new Response(null, { status: 404 });
  }

  const object = await getObject(key).catch(() => null);
  if (!object) {
    return new Response(null, { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": object.contentType,
    "Cache-Control": "public, max-age=300, must-revalidate",
    "Vercel-Cache-Tag": `${CDN_CACHE_TAG},${cdnCacheTagForKey(key)}`,
  });
  if (object.contentLength !== undefined) headers.set("Content-Length", String(object.contentLength));
  if (object.etag) headers.set("ETag", object.etag);

  return new Response(object.body, { headers });
}
