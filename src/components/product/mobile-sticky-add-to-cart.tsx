"use client";

import { useEffect, useState, type RefObject } from "react";
import { AddToCartButton } from "@/components/cart/add-to-cart-button";
import { useCurrency } from "@/context/currency-provider";
import { isCtaScrolledPast } from "@/components/product/sticky-cta";
import { setStickyAddToCartVisible } from "@/context/sticky-add-to-cart-store";
import type { Product, ProductVariant } from "@/lib/types";
import { cn } from "@/lib/utils";

/** DOM ids of the PDP's option groups, which the bar's selection label
 * scrolls back to. Set in product-detail.tsx. */
export const PDP_COLOR_GROUP_ID = "pdp-color-group";
export const PDP_SIZE_GROUP_ID = "pdp-size-group";

function scrollToOptions() {
  const target =
    document.getElementById(PDP_COLOR_GROUP_ID) ?? document.getElementById(PDP_SIZE_GROUP_ID);
  if (!target) return;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
}

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
 *
 * F-025: the bar only appears once the primary row has scrolled *past* the
 * top of the viewport (it used to show on first paint, while the row was
 * still below the fold, before the shopper had seen the pickers), and it
 * says which size/colour a tap will add — tapping that label scrolls back to
 * the pickers.
 */
export function MobileStickyAddToCart({
  product,
  variant,
  unavailable,
  quantity,
  displayPrice,
  selectionLabel,
  observeTarget,
}: {
  product: Product;
  variant?: ProductVariant;
  /** F-103/F-107: see AddToCartButton's own doc comment — forces the
   * disabled "Sold out" state for the shopper's exact current selection,
   * which passing `variant={undefined}` alone doesn't do. */
  unavailable?: boolean;
  quantity: number;
  displayPrice: number;
  /** What a tap will add, e.g. "M · Navy" (see stickySelectionLabel). */
  selectionLabel?: string;
  observeTarget: RefObject<HTMLElement | null>;
}) {
  const { formatPrice } = useCurrency();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = observeTarget.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(isCtaScrolledPast(entry)), {
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

  // F-247: while the bar covers the bottom of the viewport, globals.css adds
  // matching scroll-padding-bottom so a focused control near the bottom edge
  // is scrolled clear of it (WCAG 2.2 SC 2.4.11).
  useEffect(() => {
    if (!visible) return;
    const root = document.documentElement;
    root.setAttribute("data-sticky-cta", "");
    return () => root.removeAttribute("data-sticky-cta");
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
        <div className="min-w-0">
          <p className="font-display text-lg font-bold leading-tight text-ink">{formatPrice(displayPrice)}</p>
          {selectionLabel && (
            <button
              type="button"
              onClick={scrollToOptions}
              aria-label={`Selected ${selectionLabel}. Change size or colour`}
              className="block max-w-full truncate py-1 text-left text-xs font-semibold text-muted underline-offset-2 hover:text-brand hover:underline"
            >
              {selectionLabel}
            </button>
          )}
        </div>
        <div className="ml-auto shrink-0">
          <AddToCartButton product={product} variant={variant} unavailable={unavailable} quantity={quantity} size="md" />
        </div>
      </div>
    </div>
  );
}
