"use client";

import { MessageCircle } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { brand } from "@/data/brand";
import { whatsappHref } from "@/lib/contact/whatsapp";
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
 *
 * F-002/F-126: this used to hard-code `https://wa.me/?text=...` with no
 * phone number at all, which opens WhatsApp's "choose a contact" picker
 * instead of a chat with DAAKYKA — now it takes the real `contact.whatsapp`
 * SiteSetting from the caller (SiteShell already reads it for the utility
 * bar and footer) and builds the link with the shared `whatsappHref`
 * helper. F-126 also found this bubble overlapping the mobile checkout
 * page's Place Order button; the bubble is hidden on /checkout entirely
 * (mirroring how the utility bar's WhatsApp link and the footer's are
 * still reachable there), the same way Shopify hides chat widgets on its
 * checkout.
 */
export function WhatsAppFab({ whatsapp }: { whatsapp: string }) {
  const pathname = usePathname();
  const href = whatsappHref(whatsapp, brand.web.whatsappMessage);

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

  // F-126: on mobile, this bubble's fixed bottom-right corner overlaps the
  // full-width Place Order button on /checkout across part of the page's
  // scroll range. The utility bar's WhatsApp link and the footer's stay
  // reachable there, so hiding this one costs nothing.
  if (pathname?.startsWith("/checkout")) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-hidden={fieldFocused || undefined}
      tabIndex={fieldFocused ? -1 : undefined}
      className={cn(
        // F-328: print:hidden directly on this fixed-position element too
        // (not just the print:hidden wrapper in site-shell.tsx) — a
        // position:fixed element like this one is exactly what reprints on
        // every page of a multi-page print job, so this is its own
        // defense-in-depth, not a redundant belt-and-braces class.
        "fixed right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-trust text-white shadow-lg shadow-trust/30 transition-[bottom,opacity,transform] duration-200 hover:scale-105 hover:shadow-xl print:hidden",
        stickyCartVisible ? "bottom-28 md:bottom-6" : "bottom-6",
        fieldFocused && "max-md:pointer-events-none max-md:scale-0 max-md:opacity-0",
      )}
      aria-label="Chat on WhatsApp"
    >
      <MessageCircle size={24} />
    </a>
  );
}
