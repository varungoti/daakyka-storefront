"use client";

import {
  buildLocalCart,
  createLocalCartId,
  isShopifyCartMode,
} from "@/lib/cart/service";
import type { Cart, CartLine } from "@/lib/types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const CART_STORAGE_KEY = "daakyka-cart";
const CART_ID_KEY = "daakyka-cart-id";

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
  addToCart: (input: AddToCartInput) => Promise<void>;
  updateQuantity: (lineId: string, quantity: number) => Promise<void>;
  removeLine: (lineId: string) => Promise<void>;
  checkout: () => void;
}

const emptyCart: Cart = {
  id: "",
  lines: [],
  totalQuantity: 0,
  subtotal: 0,
  currencyCode: "INR",
};

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

function applyLocalAdd(current: Cart, input: AddToCartInput): Cart {
  const existing = current.lines.find((line) => line.variantId === input.variantId);

  let nextLines: CartLine[];

  if (existing) {
    nextLines = current.lines.map((line) =>
      line.variantId === input.variantId
        ? { ...line, quantity: line.quantity + (input.quantity ?? 1) }
        : line,
    );
  } else {
    nextLines = [
      ...current.lines,
      {
        id: `local-line-${input.variantId}`,
        variantId: input.variantId,
        productHandle: input.productHandle,
        productTitle: input.productTitle,
        variantTitle: input.variantTitle,
        quantity: input.quantity ?? 1,
        price: input.price,
        image: input.image,
      },
    ];
  }

  return buildLocalCart(nextLines);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [cartId, setCartId] = useState<string>("");
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const mode: "shopify" | "local" = isShopifyCartMode() ? "shopify" : "local";

  useEffect(() => {
    setMounted(true);
    const storedCartId = localStorage.getItem(CART_ID_KEY) ?? "";
    const storedCart = localStorage.getItem(CART_STORAGE_KEY);

    if (storedCartId) setCartId(storedCartId);

    if (!isShopifyCartMode() && storedCart) {
      try {
        setCart(JSON.parse(storedCart) as Cart);
      } catch {
        setCart(emptyCart);
      }
    }

    if (isShopifyCartMode() && storedCartId) {
      fetch(`/api/cart?cartId=${encodeURIComponent(storedCartId)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.cart) setCart(data.cart);
          else if (data.mode === "degraded" && storedCart) {
            try {
              setCart(JSON.parse(storedCart) as Cart);
            } catch {
              setCart(emptyCart);
            }
          }
        })
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart, mounted]);

  useEffect(() => {
    if (!mounted || !cartId) return;
    localStorage.setItem(CART_ID_KEY, cartId);
  }, [cartId, mounted]);

  const persistShopifyCart = useCallback((nextCart: Cart) => {
    setCart(nextCart);
    setCartId(nextCart.id);
  }, []);

  const addToCart = useCallback(
    async (input: AddToCartInput) => {
      setIsLoading(true);
      try {
        if (mode === "shopify") {
          const payload = cartId
            ? {
                action: "add",
                cartId,
                merchandiseId: input.variantId,
                quantity: input.quantity ?? 1,
              }
            : {
                action: "create",
                merchandiseId: input.variantId,
                quantity: input.quantity ?? 1,
              };

          const data = await shopifyCartRequest(payload);
          if (data.degraded) {
            setCart((current) => applyLocalAdd(current, input));
            if (!cartId) setCartId(createLocalCartId());
          } else {
            persistShopifyCart(data.cart);
          }
        } else {
          setCart((current) => applyLocalAdd(current, input));
          if (!cartId) setCartId(createLocalCartId());
        }

        setIsOpen(true);
      } finally {
        setIsLoading(false);
      }
    },
    [cartId, mode, persistShopifyCart],
  );

  const updateQuantity = useCallback(
    async (lineId: string, quantity: number) => {
      if (quantity < 1) return;
      setIsLoading(true);
      try {
        if (mode === "shopify" && cartId) {
          const data = await shopifyCartRequest({
            action: "update",
            cartId,
            lineId,
            quantity,
          });
          if (!data.degraded) {
            persistShopifyCart(data.cart);
          } else {
            setCart((current) => {
              const nextLines = current.lines.map((line) =>
                line.id === lineId ? { ...line, quantity } : line,
              );
              return buildLocalCart(nextLines);
            });
          }
        } else {
          setCart((current) => {
            const nextLines = current.lines.map((line) =>
              line.id === lineId ? { ...line, quantity } : line,
            );
            return buildLocalCart(nextLines);
          });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [cartId, mode, persistShopifyCart],
  );

  const removeLine = useCallback(
    async (lineId: string) => {
      setIsLoading(true);
      try {
        if (mode === "shopify" && cartId) {
          const data = await shopifyCartRequest({
            action: "remove",
            cartId,
            lineIds: [lineId],
          });
          if (!data.degraded) {
            persistShopifyCart(data.cart);
          } else {
            setCart((current) => {
              const nextLines = current.lines.filter((line) => line.id !== lineId);
              return buildLocalCart(nextLines);
            });
          }
        } else {
          setCart((current) => {
            const nextLines = current.lines.filter((line) => line.id !== lineId);
            return buildLocalCart(nextLines);
          });
        }
      } finally {
        setIsLoading(false);
      }
    },
    [cartId, mode, persistShopifyCart],
  );

  const checkout = useCallback(() => {
    if (mode === "shopify" && cart.checkoutUrl) {
      window.location.href = cart.checkoutUrl;
      return;
    }
    window.location.href = "/checkout";
  }, [cart.checkoutUrl, mode]);

  const value = useMemo(
    () => ({
      cart,
      isOpen,
      isLoading,
      mode,
      openCart: () => setIsOpen(true),
      closeCart: () => setIsOpen(false),
      addToCart,
      updateQuantity,
      removeLine,
      checkout,
    }),
    [addToCart, cart, checkout, isLoading, isOpen, mode, removeLine, updateQuantity],
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
