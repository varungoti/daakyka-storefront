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
      // F-104: this runs in a visibilitychange handler, so a thrown
      // SecurityError (storage blocked) can't reach a React error boundary
      // — but it would still spam the console and skip the beacon.
      try {
        if (sessionStorage.getItem(ABANDON_KEY) === fingerprint) return;
      } catch {
        // Storage blocked — fall through and send; we just lose the
        // once-per-fingerprint dedupe for this session.
      }

      const payload = JSON.stringify({
        cartId: current.id,
        subtotal: current.subtotal,
        itemCount: current.totalQuantity,
        items: current.lines.map((line) => ({
          title: line.productTitle,
          quantity: line.quantity,
        })),
      });

      if (typeof navigator.sendBeacon === "function") {
        navigator.sendBeacon("/api/cart/abandon", new Blob([payload], { type: "application/json" }));
      }
      try {
        sessionStorage.setItem(ABANDON_KEY, fingerprint);
      } catch {
        // Ignore — see the read above.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") sendAbandon();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return null;
}
