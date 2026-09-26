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
import { useRouter, usePathname } from "next/navigation";
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
  /** F-108: the stock ceiling to clamp this line's quantity to — see
   * CartLine.maxQuantity's own doc comment. */
  maxQuantity?: number;
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

/** F-108: clamps a line's quantity to its maxQuantity (the stock the
 * variant had when it was last added), when one is set. `undefined` means
 * "not stock-tracked" — never clamped. */
function clampToMax(quantity: number, maxQuantity: number | undefined): number {
  return typeof maxQuantity === "number" ? Math.min(quantity, Math.max(0, maxQuantity)) : quantity;
}

function applyLocalAdds(current: Cart, inputs: AddToCartInput[]): Cart {
  let lines = current.lines;

  for (const input of inputs) {
    const existing = lines.find((line) => line.variantId === input.variantId);
    if (existing) {
      lines = lines.map((line) =>
        line.variantId === input.variantId
          ? {
              ...line,
              quantity: clampToMax(line.quantity + (input.quantity ?? 1), input.maxQuantity ?? line.maxQuantity),
              // A later add's maxQuantity (fresher stock read) wins over a
              // stale one already on the line.
              maxQuantity: input.maxQuantity ?? line.maxQuantity,
            }
          : line,
      );
    } else {
      const newLine: CartLine = {
        id: `local-line-${input.variantId}`,
        variantId: input.variantId,
        productHandle: input.productHandle,
        productTitle: input.productTitle,
        variantTitle: input.variantTitle,
        quantity: clampToMax(input.quantity ?? 1, input.maxQuantity),
        price: input.price,
        image: input.image,
        maxQuantity: input.maxQuantity,
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
  const pathname = usePathname();

  // F-033: the drawer used to stay open on top of /checkout after "Buy
  // Now" or the drawer's own "Continue to Checkout" — checkout() only
  // ever called router.push, never setIsOpen(false), and Buy Now opens
  // the drawer via addToCart before it calls checkout(). On mobile the
  // drawer is full-width, so it looked like navigation had silently done
  // nothing; the drawer's own CTA button, now a no-op back on /checkout,
  // was the only way most shoppers would think to try again. This is the
  // safety net for every other way the route can change under the
  // drawer (back/forward, a header link) — checkout() below (the common
  // case) also closes it directly so there's no one-frame flash open.
  // Adjusted during render (not a useEffect) per this repo's
  // react-hooks/set-state-in-effect convention — see e.g.
  // product-detail.tsx's GalleryColumn.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (isOpen) setIsOpen(false);
  }

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
            line.id === lineId ? { ...line, quantity: clampToMax(quantity, line.maxQuantity) } : line,
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
    // F-033: close first so there's no one-frame flash of the drawer
    // still open right as /checkout renders, and so a drawer CTA tapped
    // while already on /checkout at least closes the drawer instead of
    // doing nothing.
    setIsOpen(false);
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
