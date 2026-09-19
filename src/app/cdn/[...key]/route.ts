import { resolveCdnObjectKey } from "@/lib/storage/cdn-key";
import { getObject } from "@/lib/storage/r2";

/**
 * Serves R2-stored media (AI-generated and uploaded product/site images)
 * from this app's own origin instead of requiring the R2 bucket to be
 * publicly readable — see publicUrlForKey() in src/lib/storage/r2.ts.
 * Object keys are UUID-named and never reused (a "replace" writes a new
 * key and deletes the old one — see saveMediaAsset in src/lib/media/store.ts),
 * so a successful response is safe to cache as immutable.
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
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  if (object.contentLength !== undefined) headers.set("Content-Length", String(object.contentLength));
  if (object.etag) headers.set("ETag", object.etag);

  return new Response(object.body, { headers });
}
