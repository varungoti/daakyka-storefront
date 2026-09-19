"use client";

import { useEffect, useState, type RefObject } from "react";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { useCurrency } from "@/context/currency-provider";
import { setStickyAddToCartVisible } from "@/context/sticky-add-to-cart-store";
import type { Product, ProductVariant } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Dawn-style slide-up bar for mobile PDPs (release-hardening
 * storefront-ux F6): once the primary Add to Cart row scrolls out of
 * view, this bar slides up with the price and an Add to Cart action so a
 * shopper reading the description/accordions/reviews on a long PDP never
 * has to scroll back to the top to buy. Desktop is unaffected (`md:hidden`
 * below) — its CTA never leaves a comfortable scroll distance the way a
 * long mobile PDP does.
 *
 * Reuses the exact same <AddToCartButton> the primary CTA renders, with
 * the same `product`/`variant`/`quantity` props ProductDetail already
 * resolved from the shopper's selected size/colour — so the stock-aware
 * disabled state and the add-to-cart behaviour are always identical
 * between the two buttons; nothing here re-implements variant resolution
 * or cart mutation.
 */
export function MobileStickyAddToCart({
  product,
  variant,
  quantity,
  displayPrice,
  observeTarget,
}: {
  product: Product;
  variant?: ProductVariant;
  quantity: number;
  displayPrice: number;
  observeTarget: RefObject<HTMLElement | null>;
}) {
  const { formatPrice } = useCurrency();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = observeTarget.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting), {
      rootMargin: "0px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [observeTarget]);

  // Tell the (unrelated, higher-up-the-tree) WhatsApp bubble to get out of
  // the way while this bar is on screen — see
  // src/context/sticky-add-to-cart-store.ts and src/components/layout/whatsapp-fab.tsx.
  // Also clears on unmount (navigating away from the PDP).
  useEffect(() => {
    setStickyAddToCartVisible(visible);
    return () => setStickyAddToCartVisible(false);
  }, [visible]);

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 p-3 shadow-[0_-8px_24px_var(--shadow-tint)] backdrop-blur-md transition-transform duration-300 ease-out md:hidden",
        "pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
        visible ? "translate-y-0" : "pointer-events-none translate-y-full",
      )}
    >
      <div className="mx-auto flex max-w-[1320px] items-center gap-3">
        <p className="font-display text-lg font-bold text-ink">{formatPrice(displayPrice)}</p>
        <div className="ml-auto">
          <AddToCartButton product={product} variant={variant} quantity={quantity} size="md" />
        </div>
      </div>
    </div>
  );
}
