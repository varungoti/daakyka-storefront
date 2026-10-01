import type { Cart, CartLine } from "@/lib/types";

// The Shopify Storefront-API cart functions that used to live here
// (createShopifyCart/getShopifyCart/addToShopifyCart/updateShopifyCartLine/
// removeFromShopifyCart) were removed as dead code (release-hardening,
// audit finding F5): they spoke Shopify cart GIDs and were never wired to
// the real Prisma catalog (products/variants use cuids). This function
// used to return `isShopifyConfigured()`, so setting the two
// NEXT_PUBLIC_SHOPIFY_* vars alone (e.g. by following the old
// SHOPIFY_SETUP.md) flipped every cart into "shopify" mode and POSTed to
// `/api/cart`, which no longer exists — add-to-cart failed site-wide
// (audit finding F-231). `/api/cart` (the Storefront-API cart route) is
// gone for good, so this mode can never work again — hard-coded `false`,
// not derived from env, so no future env var can re-enable it by
// accident. `isShopifyCartMode()` is kept only because
// src/context/cart-provider.tsx still compiles against the
// "shopify" | "local" mode union.

export function isShopifyCartMode(): boolean {
  return false;
}

export function createLocalCartId(): string {
  return `local-${crypto.randomUUID()}`;
}

/** True for cart ids minted client-side, never a real Shopify cart GID. */
export function isLocalCartId(cartId: string): boolean {
  return cartId.startsWith("local-");
}

/**
 * F-122: this used to hard-code `id: "local-cart"` for every cart, so the
 * abandoned-cart beacon (which dedupes per cartId for an hour) recorded at
 * most one abandonment per hour for the whole store. The id is now a
 * required argument — callers pass the per-browser `local-<uuid>` held in
 * cart-store (`getCartIdSnapshot()`, minted by `createLocalCartId()`) — so a
 * cart can never again silently share the sentinel.
 */
export function buildLocalCart(lines: CartLine[], cartId: string): Cart {
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = lines.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  );

  return {
    id: cartId,
    lines,
    totalQuantity,
    subtotal,
    currencyCode: "INR",
  };
}

const UNIQUE_LOCAL_CART_ID = /^local-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True only for a genuine per-browser id from `createLocalCartId()` — not
 * the retired shared "local-cart" sentinel, and not an arbitrary string. */
export function isUniqueLocalCartId(cartId: string): boolean {
  return UNIQUE_LOCAL_CART_ID.test(cartId);
}

/**
 * Builds the body of the abandoned-cart beacon, plus the per-session
 * fingerprint the tracker uses to avoid re-sending an unchanged cart.
 * Returns `null` when there is nothing worth recording: an empty cart, or no
 * real per-cart id yet (never fall back to a shared one — see
 * `buildLocalCart`). Deliberately carries no email: the public endpoint must
 * never take an identity to contact (F-072).
 */
export function buildAbandonBeacon(
  cart: Cart,
  cartId: string,
): { fingerprint: string; payload: string } | null {
  if (cart.totalQuantity === 0 || !isUniqueLocalCartId(cartId)) return null;
  return {
    fingerprint: `${cartId}-${cart.totalQuantity}-${cart.subtotal}`,
    payload: JSON.stringify({
      cartId,
      subtotal: cart.subtotal,
      itemCount: cart.totalQuantity,
      items: cart.lines.map((line) => ({
        title: line.productTitle,
        quantity: line.quantity,
      })),
    }),
  };
}
