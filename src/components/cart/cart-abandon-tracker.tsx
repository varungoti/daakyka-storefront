"use client";

import { useCart } from "@/context/cart-provider";
import { useEffect, useRef } from "react";

const ABANDON_KEY = "daakyka-abandon-sent";

export function CartAbandonTracker() {
  const { cart } = useCart();
  const cartRef = useRef(cart);

  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  useEffect(() => {
    const sendAbandon = () => {
      const current = cartRef.current;
      if (current.totalQuantity === 0) return;

      const fingerprint = `${current.id}-${current.totalQuantity}-${current.subtotal}`;
      if (sessionStorage.getItem(ABANDON_KEY) === fingerprint) return;

      const payload = JSON.stringify({
        cartId: current.id,
        subtotal: current.subtotal,
        itemCount: current.totalQuantity,
        items: current.lines.map((line) => ({
          title: line.productTitle,
          quantity: line.quantity,
        })),
      });

      navigator.sendBeacon("/api/cart/abandon", new Blob([payload], { type: "application/json" }));
      sessionStorage.setItem(ABANDON_KEY, fingerprint);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendAbandon();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return null;
}
