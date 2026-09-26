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

export function buildLocalCart(lines: CartLine[]): Cart {
  const totalQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = lines.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  );

  return {
    id: "local-cart",
    lines,
    totalQuantity,
    subtotal,
    currencyCode: "INR",
  };
}
