"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { brand } from "@/data/brand";
import {
  getServerStickyAddToCartVisible,
  getStickyAddToCartVisible,
  subscribeStickyAddToCartVisible,
} from "@/context/sticky-add-to-cart-store";
import { cn } from "@/lib/utils";

const FORM_FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * storefront-ux F10 (+ its follow-on note in F6): this bubble floats in
 * the same bottom-right corner as (a) a focused mobile form field — most
 * concretely checkout's "Address line 2" input, which it used to sit on
 * top of — and (b) the PDP's mobile sticky Add-to-Cart bar (F6). Both are
 * handled here rather than in those components, so neither has to know
 * the bubble exists:
 *  - While a form field is focused on a small screen, the bubble shrinks
 *    away (`max-md:` — desktop has no overlap problem, there's room for
 *    both) instead of sitting on top of the input's tap target.
 *  - While the sticky Add-to-Cart bar is on screen, the bubble moves up
 *    above it via the shared sticky-add-to-cart-store, instead of the two
 *    fixed elements stacking on the same corner.
 */
export function WhatsAppFab() {
  const message = encodeURIComponent(brand.web.whatsappMessage);
  const href = `https://wa.me/?text=${message}`;

  const stickyCartVisible = useSyncExternalStore(
    subscribeStickyAddToCartVisible,
    getStickyAddToCartVisible,
    getServerStickyAddToCartVisible,
  );
  const [fieldFocused, setFieldFocused] = useState(false);

  useEffect(() => {
    const isFormField = (target: EventTarget | null) =>
      target instanceof HTMLElement && FORM_FIELD_TAGS.has(target.tagName);
    const onFocusIn = (event: FocusEvent) => {
      if (isFormField(event.target)) setFieldFocused(true);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (isFormField(event.target)) setFieldFocused(false);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-hidden={fieldFocused || undefined}
      tabIndex={fieldFocused ? -1 : undefined}
      className={cn(
        "fixed right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-trust text-white shadow-lg shadow-trust/30 transition-[bottom,opacity,transform] duration-200 hover:scale-105 hover:shadow-xl",
        stickyCartVisible ? "bottom-28 md:bottom-6" : "bottom-6",
        fieldFocused && "max-md:pointer-events-none max-md:scale-0 max-md:opacity-0",
      )}
      aria-label="Chat on WhatsApp"
    >
      <MessageCircle size={24} />
    </a>
  );
}
