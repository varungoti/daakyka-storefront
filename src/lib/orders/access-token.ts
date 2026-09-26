import { createHash, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { safeEquals } from "@/lib/security/timing-safe-equal";

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

/**
 * F-284 fix: a *stateless* alternative way to authorize `/order/[number]`,
 * for the one caller that has no capability token to hand out — the
 * Razorpay webhook (src/app/api/webhooks/razorpay/route.ts) only ever
 * sees `Order.accessTokenHash`, never the raw token behind it (by design —
 * see this module's header comment), so when the webhook wins the race
 * against POST /api/checkout/verify (the guest's browser closed the tab,
 * or the webhook simply lands first), the "Payment received" email it
 * sends previously had no working link at all.
 *
 * `sig` is an HMAC over the order's own id + number, keyed off a secret
 * *derived* from AUTH_SECRET via HKDF with a distinct label — never
 * AUTH_SECRET directly (which also signs admin/customer session JWTs) and
 * never the Razorpay webhook secret. Same trust model as the capability
 * token it complements: never expires, isn't single-use, and its only
 * privilege is read access to one order's own confirmation page — see
 * getAuthorizedOrder (src/lib/orders/get-order.ts), which accepts either.
 */
function deriveOrderLinkKey(): Buffer {
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret) {
    throw new Error("AUTH_SECRET environment variable is required");
  }
  return Buffer.from(hkdfSync("sha256", authSecret, "", "daakyka:order-link:v1", 32));
}

export function signOrderLink(orderId: string, orderNumber: string): string {
  return createHmac("sha256", deriveOrderLinkKey())
    .update(`order-link:v1:${orderId}:${orderNumber}`)
    .digest("base64url");
}

export function verifyOrderLinkSignature(orderId: string, orderNumber: string, signature: string): boolean {
  try {
    return safeEquals(signOrderLink(orderId, orderNumber), signature);
  } catch {
    // AUTH_SECRET missing — same fail-closed behaviour as every other
    // caller of it (src/lib/auth/session.ts, src/lib/customer-auth/session.ts).
    return false;
  }
}
