import type { Cart, CartLine } from "@/lib/types";
import { buildLocalCart } from "@/lib/cart/service";

const CART_STORAGE_KEY = "daakyka-cart";
const CART_ID_KEY = "daakyka-cart-id";

export const EMPTY_CART: Cart = {
  id: "",
  lines: [],
  totalQuantity: 0,
  subtotal: 0,
  currencyCode: "INR",
};

let cachedCart: Cart = EMPTY_CART;
let cachedCartId = "";
let hydrated = false;
const listeners = new Set<() => void>();

// The cache survives application upgrades. Never hand decoded JSON directly
// to CartDrawer: it reads cart.lines on every page, even before the drawer opens.
function usableLine(value: unknown): value is CartLine {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return ["id", "variantId", "productHandle", "productTitle", "variantTitle", "image"]
    .every((key) => typeof row[key] === "string") &&
    typeof row.quantity === "number" && Number.isSafeInteger(row.quantity) && row.quantity > 0 &&
    typeof row.price === "number" && Number.isFinite(row.price) && row.price >= 0 &&
    (row.maxQuantity === undefined || (typeof row.maxQuantity === "number" &&
      Number.isSafeInteger(row.maxQuantity) && row.maxQuantity >= 0));
}

function restoreLocalCart(stored: string | null): Cart {
  if (!stored) return EMPTY_CART;
  const parsed: unknown = JSON.parse(stored);
  if (!parsed || typeof parsed !== "object" || !("lines" in parsed) || !Array.isArray(parsed.lines)) {
    return EMPTY_CART;
  }
  // Retain valid selections even if another line is damaged. The catalog and
  // quote service remain authoritative for current availability and pricing.
  const lines = parsed.lines.filter(usableLine);
  const id = "id" in parsed && typeof parsed.id === "string" ? parsed.id : cachedCartId;
  return buildLocalCart(lines, id);
}

function hydrateFromStorage() {
  if (hydrated) return;
  hydrated = true;
  try {
    cachedCartId = window.localStorage.getItem(CART_ID_KEY) ?? "";
  } catch {
    cachedCartId = "";
  }
  try {
    const stored = window.localStorage.getItem(CART_STORAGE_KEY);
    cachedCart = restoreLocalCart(stored);
  } catch {
    cachedCart = EMPTY_CART;
  }
}

function persistCart(cart: Cart) {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  } catch {
    // Ignore storage failures (private browsing, quota); the in-memory
    // cache still reflects the change for the rest of this page view.
  }
}

function persistCartId(cartId: string) {
  try {
    if (cartId) window.localStorage.setItem(CART_ID_KEY, cartId);
    else window.localStorage.removeItem(CART_ID_KEY);
  } catch {
    // See persistCart.
  }
}

function emitChange() {
  for (const listener of listeners) listener();
}

export function getCartSnapshot(): Cart {
  hydrateFromStorage();
  return cachedCart;
}

export function getCartIdSnapshot(): string {
  hydrateFromStorage();
  return cachedCartId;
}

export function getServerCartSnapshot(): Cart {
  return EMPTY_CART;
}

export function getServerCartIdSnapshot(): string {
  return "";
}

export function subscribeToCart(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  const onStorageEvent = (event: StorageEvent) => {
    // A different tab's localStorage.clear() uses a null key, not one event
    // per removed item. Otherwise this tab can resurrect a cleared basket.
    if (event.key === null || event.key === CART_STORAGE_KEY || event.key === CART_ID_KEY) {
      hydrated = false;
      onStoreChange();
    }
  };
  window.addEventListener("storage", onStorageEvent);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorageEvent);
  };
}

/** Replaces the cart contents (and, when Shopify-backed, its cart id). */
export function setCartState(next: { cart?: Cart; cartId?: string }): void {
  hydrateFromStorage();
  if (next.cart !== undefined) {
    cachedCart = next.cart;
    persistCart(next.cart);
  }
  if (next.cartId !== undefined) {
    cachedCartId = next.cartId;
    persistCartId(next.cartId);
  }
  emitChange();
}

/** Clears a Shopify cart id that Shopify no longer recognizes (expired or
 * invalid), without discarding the customer's cart contents — the next
 * mutation creates a fresh Shopify cart from those lines. */
export function clearCartId(): void {
  setCartState({ cartId: "" });
}
