"use client";

import { useCart } from "@/context/cart-provider";
import { getCartIdSnapshot } from "@/context/cart-store";
import { buildAbandonBeacon } from "@/lib/cart/service";
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
      // F-122: key the event on the per-browser cart id from the cart store,
      // not `cart.id` — that was the shared "local-cart" sentinel for every
      // shopper, so the route's one-event-per-cartId-per-hour dedupe
      // swallowed every abandonment after the first, store-wide. (Carts
      // persisted before the fix still carry the old `cart.id` in storage.)
      const beacon = buildAbandonBeacon(cartRef.current, getCartIdSnapshot());
      if (!beacon) return;
      const { fingerprint, payload } = beacon;
      // F-104: this runs in a visibilitychange handler, so a thrown
      // SecurityError (storage blocked) can't reach a React error boundary
      // — but it would still spam the console and skip the beacon.
      try {
        if (sessionStorage.getItem(ABANDON_KEY) === fingerprint) return;
      } catch {
        // Storage blocked — fall through and send; we just lose the
        // once-per-fingerprint dedupe for this session.
      }

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
