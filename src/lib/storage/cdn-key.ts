/**
 * Resolves the `[...key]` route params of `/cdn/[...key]` (see
 * src/app/cdn/[...key]/route.ts) into a safe R2 object key, or returns
 * `null` when the request should be rejected.
 *
 * F5 fix (docs/audit-2026-09-19/security.md): Next.js hands route
 * handlers already-decoded path segments — a raw URL segment of
 * `%2e%2e` arrives here as the string `".."`. This module's caller
 * historically decoded a SECOND time (segments.map(decodeURIComponent))
 * to support object keys containing a literal `%`-prefixed substring
 * that the client percent-encoded on top of the URL's own encoding —
 * but it ran its traversal guard BEFORE that second decode. A
 * double-encoded segment sent as `%252e%252e` arrives here already
 * decoded once (by Next) as the literal string `%2e%2e`, which is not
 * `".."` and passed the old guard — only becoming `".."` once the
 * second, unchecked decode ran afterward.
 *
 * The fix is to decode fully FIRST and validate every segment AFTER
 * that final decode. The guard also now rejects any segment that
 * merely CONTAINS `..`, `/`, or `\` (not just an exact match), because
 * a decoded segment can smuggle in a brand-new path separator that
 * wasn't part of the URL's own segment structure (e.g. a raw `%252f`
 * round-trips through Next's decode to `%2f`, then this module's decode
 * to a literal `/`), which would otherwise let one array element
 * effectively split into several path components after the fact.
 *
 * Not independently exploitable today — R2/S3 object keys are a flat
 * namespace, not a filesystem path, so a `..` in a key has no
 * directory-traversal effect against getObject()'s current
 * implementation — but this closes the gap before a future storage
 * backend (e.g. local disk) could make it one.
 */
export function resolveCdnObjectKey(segments: string[]): string | null {
  if (segments.length === 0) return null;

  let decoded: string[];
  try {
    decoded = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    // Malformed percent-encoding (e.g. a lone "%") throws URIError —
    // treat exactly like any other invalid key.
    return null;
  }

  const isUnsafeSegment = (segment: string): boolean =>
    segment === "" ||
    segment === "." ||
    segment === ".." ||
    segment.includes("..") ||
    segment.includes("/") ||
    segment.includes("\\");

  if (decoded.some(isUnsafeSegment)) return null;

  return decoded.join("/");
}
