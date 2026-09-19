import { createHash, randomBytes } from "node:crypto";

/**
 * Phase G hardening (fixes finding F2 — see docs/audit-2026-09-19/security.md):
 * capability token for guest access to `/order/[number]` (src/lib/orders/get-order.ts).
 *
 * Same approach as src/lib/customer-auth/tokens.ts: 32 bytes of
 * crypto.randomBytes, base64url-encoded (256 bits of entropy, nothing
 * brute-forceable, no characters that need escaping in a query string).
 * Only the SHA-256 hash is ever persisted (`Order.accessTokenHash`) — the
 * raw value exists only in the checkout redirect URL and the
 * order-confirmation email link.
 *
 * Kept as its own tiny module rather than importing
 * customer-auth/tokens.ts directly: this token guards a different
 * resource (a possibly-guest Order, not a Customer), has no expiry, and
 * isn't single-use (a customer may revisit their confirmation link any
 * number of times), so it deliberately doesn't share CustomerToken's
 * TTL/usedAt columns, table, or consume-once semantics.
 */
export function generateOrderAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOrderAccessToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
