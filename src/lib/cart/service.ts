import { isShopifyConfigured } from "@/lib/shopify/config";
import type { Cart, CartLine } from "@/lib/types";

// The Shopify Storefront-API cart functions that used to live here
// (createShopifyCart/getShopifyCart/addToShopifyCart/updateShopifyCartLine/
// removeFromShopifyCart) were removed as dead code (release-hardening,
// audit finding F5): they spoke Shopify cart GIDs and were never wired to
// the real Prisma catalog (products/variants use cuids), so
// isShopifyCartMode() below would have broken immediately if ever enabled
// against this app's DB-native checkout. `isShopifyConfigured()` is kept
// because `isShopifyCartMode()` still has one real caller
// (src/context/cart-provider.tsx, which must keep compiling against the
// "shopify" | "local" mode union — see that file) — with the Storefront
// API vars now undocumented, this always evaluates to false in practice,
// so the app runs local-cart-only, same as today.

export function isShopifyCartMode(): boolean {
  return isShopifyConfigured();
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
