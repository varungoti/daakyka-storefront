import type { Cart } from "@/lib/types";

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
    cachedCart = stored ? (JSON.parse(stored) as Cart) : EMPTY_CART;
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
    if (event.key === CART_STORAGE_KEY || event.key === CART_ID_KEY) {
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
