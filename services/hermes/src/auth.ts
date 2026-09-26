import { timingSafeEqual } from "node:crypto";

/**
 * F-306: POST /tasks used to have no auth check at all, even though the
 * storefront always sends `Authorization: Bearer $HERMES_API_KEY`.
 * Pulled out of server.ts so it can be unit-tested without booting the
 * actual HTTP server (server.ts calls `server.listen` at import time).
 */
export function isAuthorized(authorization: string | undefined, expected: string | undefined): boolean {
  // Fail closed: no key configured means no access, not open access.
  if (!expected) return false;
  if (!authorization || !authorization.startsWith("Bearer ")) return false;
  const provided = authorization.slice("Bearer ".length);
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // timingSafeEqual throws on mismatched lengths rather than returning
  // false, and itself leaks length via that throw, so compare lengths
  // first (a cheap, non-secret property) before the constant-time compare.
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}
