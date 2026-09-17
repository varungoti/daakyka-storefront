"use client";

import {
  buildLocalCart,
  createLocalCartId,
  isLocalCartId,
  isShopifyCartMode,
} from "@/lib/cart/service";
import {
  clearCartId,
  getCartIdSnapshot,
  getCartSnapshot,
  getServerCartSnapshot,
  setCartState,
  subscribeToCart,
} from "@/context/cart-store";
import type { Cart, CartLine } from "@/lib/types";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

interface AddToCartInput {
  variantId: string;
  productHandle: string;
  productTitle: string;
  variantTitle: string;
  price: number;
  image: string;
  quantity?: number;
}

interface CartContextValue {
  cart: Cart;
  isOpen: boolean;
  isLoading: boolean;
  mode: "shopify" | "local";
  openCart: () => void;
  closeCart: () => void;
  /** Adds one line and returns the resulting cart (so callers like "Buy
   * Now" can redirect using its checkoutUrl instead of a stale one). */
  addToCart: (input: AddToCartInput) => Promise<Cart>;
  /** Adds several lines in a single request, e.g. a Mix & Match "add
   * complete set" — avoids racing two separate add calls against the
   * same cart id, which can silently drop one of the items. */
  addLinesToCart: (inputs: AddToCartInput[]) => Promise<Cart>;
  updateQuantity: (lineId: string, quantity: number) => Promise<void>;
  removeLine: (lineId: string) => Promise<void>;
  checkout: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

async function shopifyCartRequest(body: Record<string, unknown>) {
  const response = await fetch("/api/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (data.mode === "degraded") {
    return { degraded: true as const, error: data.error as string };
  }
  if (!response.ok) {
    throw new Error(data.error ?? "Cart request failed");
  }
  return { degraded: false as const, cart: data.cart as Cart };
}

function applyLocalAdds(current: Cart, inputs: AddToCartInput[]): Cart {
  let lines = current.lines;

  for (const input of inputs) {
    const existing = lines.find((line) => line.variantId === input.variantId);
    if (existing) {
      lines = lines.map((line) =>
        line.variantId === input.variantId
          ? { ...line, quantity: line.quantity + (input.quantity ?? 1) }
          : line,
      );
    } else {
      const newLine: CartLine = {
        id: `local-line-${input.variantId}`,
        variantId: input.variantId,
        productHandle: input.productHandle,
        productTitle: input.productTitle,
        variantTitle: input.variantTitle,
        quantity: input.quantity ?? 1,
        price: input.price,
        image: input.image,
      };
      lines = [...lines, newLine];
    }
  }

  return buildLocalCart(lines);
}

export function CartProvider({ children }: { children: ReactNode }) {
  // cart.id already changes in lockstep with the cart id (setCartState
  // sets both together), so a single subscription is enough to re-render
  // on every mutation; the id itself is read fresh via getCartIdSnapshot()
  // where it's needed, since that module-level cache is synchronously
  // current even before this component re-renders.
  const cart = useSyncExternalStore(subscribeToCart, getCartSnapshot, getServerCartSnapshot);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const mode: "shopify" | "local" = isShopifyCartMode() ? "shopify" : "local";
  const router = useRouter();

  // One-time reconciliation with Shopify on mount: a cart id can go
  // stale (expired, or the order already completed) without the
  // browser ever finding out. Left unhandled, every future mutation
  // keeps resending that dead id and silently falling into local mode.
  useEffect(() => {
    if (mode !== "shopify") return;
    const storedCartId = getCartIdSnapshot();
    if (!storedCartId || isLocalCartId(storedCartId)) return;

    fetch(`/api/cart?cartId=${encodeURIComponent(storedCartId)}`)
      .then((res) => res.json())
      .then((data: { cart: Cart | null; mode?: string }) => {
        if (data.cart) {
          setCartState({ cart: data.cart, cartId: data.cart.id });
        } else if (data.mode === "shopify") {
          // Shopify no longer recognizes this cart id. Drop it so the
          // next add creates a fresh cart; keep the cached local lines
          // so the customer doesn't see their cart disappear.
          clearCartId();
        }
        // data.mode === "degraded": leave the locally cached cart as-is.
      })
      .catch(() => undefined);
  }, [mode]);

  const addLinesToCart = useCallback(
    async (inputs: AddToCartInput[]): Promise<Cart> => {
      if (!inputs.length) return getCartSnapshot();

      setIsLoading(true);
      try {
        if (mode === "shopify") {
          // Read from the store directly (not React state): the store's
          // cache updates synchronously on every call below, so a second
          // add in the same click handler (before any re-render) still
          // sees the cart id the first add just created.
          const currentCartId = getCartIdSnapshot();
          const hasRealCartId = Boolean(currentCartId) && !isLocalCartId(currentCartId);
          const shopifyLines = inputs.map((input) => ({
            merchandiseId: input.variantId,
            quantity: input.quantity ?? 1,
          }));

          let data = hasRealCartId
            ? await shopifyCartRequest({
                action: "add",
                cartId: currentCartId,
                lines: shopifyLines,
              })
            : await shopifyCartRequest({ action: "create", lines: shopifyLines });

          // A stale cart id (expired, already checked out) fails as
          // "degraded" server-side; retry once as a fresh cart instead of
          // dropping straight to local-only mode.
          if (data.degraded && hasRealCartId) {
            data = await shopifyCartRequest({ action: "create", lines: shopifyLines });
          }

          if (data.degraded) {
            const next = applyLocalAdds(getCartSnapshot(), inputs);
            const nextCartId = getCartIdSnapshot() || createLocalCartId();
            setCartState({ cart: next, cartId: nextCartId });
            setIsOpen(true);
            return next;
          }

          setCartState({ cart: data.cart, cartId: data.cart.id });
          setIsOpen(true);
          return data.cart;
        }

        const next = applyLocalAdds(getCartSnapshot(), inputs);
        const nextCartId = getCartIdSnapshot() || createLocalCartId();
        setCartState({ cart: next, cartId: nextCartId });
        setIsOpen(true);
        return next;
      } finally {
        setIsLoading(false);
      }
    },
    [mode],
  );

  const addToCart = useCallback(
    (input: AddToCartInput) => addLinesToCart([input]),
    [addLinesToCart],
  );

  const updateQuantity = useCallback(
    async (lineId: string, quantity: number) => {
      if (quantity < 1) return;
      setIsLoading(true);
      try {
        const currentCartId = getCartIdSnapshot();
        if (mode === "shopify" && currentCartId && !isLocalCartId(currentCartId)) {
          const data = await shopifyCartRequest({
            action: "update",
            cartId: currentCartId,
            lineId,
            quantity,
          });
          if (!data.degraded) {
            setCartState({ cart: data.cart, cartId: data.cart.id });
            return;
          }
        }
        const next = buildLocalCart(
          getCartSnapshot().lines.map((line) =>
            line.id === lineId ? { ...line, quantity } : line,
          ),
        );
        setCartState({ cart: next });
      } finally {
        setIsLoading(false);
      }
    },
    [mode],
  );

  const removeLine = useCallback(
    async (lineId: string) => {
      setIsLoading(true);
      try {
        const currentCartId = getCartIdSnapshot();
        if (mode === "shopify" && currentCartId && !isLocalCartId(currentCartId)) {
          const data = await shopifyCartRequest({
            action: "remove",
            cartId: currentCartId,
            lineIds: [lineId],
          });
          if (!data.degraded) {
            setCartState({ cart: data.cart, cartId: data.cart.id });
            return;
          }
        }
        const next = buildLocalCart(getCartSnapshot().lines.filter((line) => line.id !== lineId));
        setCartState({ cart: next });
      } finally {
        setIsLoading(false);
      }
    },
    [mode],
  );

  const checkout = useCallback(() => {
    if (mode === "shopify" && cart.checkoutUrl) {
      // External Shopify domain — a full navigation, not a Next.js route.
      window.location.href = cart.checkoutUrl;
      return;
    }
    router.push("/checkout");
  }, [cart.checkoutUrl, mode, router]);

  const value = useMemo(
    () => ({
      cart,
      isOpen,
      isLoading,
      mode,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
      addToCart,
      addLinesToCart,
      updateQuantity,
      removeLine,
      checkout,
    }),
    [
      addLinesToCart,
      addToCart,
      cart,
      checkout,
      isLoading,
      isOpen,
      mode,
      removeLine,
      updateQuantity,
    ],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within CartProvider");
  }
  return context;
}
