"use client";

import { isTrackableNavigationClick } from "@/lib/ui/navigation-click";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// If the address never changes (a link that redirects back, or one that failed
// to load), stop showing progress rather than leave the bar up for good.
const GIVE_UP_AFTER_MS = 10_000;

/**
 * F-091: a thin bar across the top of the page from the moment a shopper taps a
 * link to another page until that page has replaced the old one. Without it, a
 * tap on a route that renders per request (contact, checkout, an order page)
 * leaves the previous page untouched until the server answers, and on a slow
 * phone connection that looks like the tap did nothing.
 *
 * It watches clicks on ordinary links, so it covers every navigation in the
 * site, header and footer included, without each link having to opt in. It sits
 * outside the page tree on purpose — see isTrackableNavigationClick for why a
 * root loading.tsx was not used. Purely visual (aria-hidden); a screen reader
 * hears the page change itself.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  // The page the shopper was on when they tapped a link. The bar shows while
  // that is still the current page.
  const [leaving, setLeaving] = useState<string | null>(null);

  useEffect(() => {
    let giveUp: ReturnType<typeof setTimeout> | undefined;

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a");
      if (!target || !anchor) return;
      // A button inside a link (a card's heart or Quick Add) handles its own
      // click; the link itself is not followed.
      const control = target.closest("button, [role='button'], input, select, textarea");
      if (control && anchor.contains(control)) return;

      const trackable = isTrackableNavigationClick({
        href: anchor.href,
        target: anchor.target,
        download: anchor.hasAttribute("download"),
        currentHref: window.location.href,
        button: event.button,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
      if (!trackable) return;

      setLeaving(window.location.pathname);
      clearTimeout(giveUp);
      giveUp = setTimeout(() => setLeaving(null), GIVE_UP_AFTER_MS);
    };

    // Bubble phase on purpose: a handler that stops the click from propagating
    // (a button over a card's link) means no navigation, and never gets here.
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      clearTimeout(giveUp);
    };
  }, []);

  if (leaving === null || leaving !== pathname) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[110] h-0.5 print:hidden">
      <div className="h-full animate-nav-progress bg-brand" />
    </div>
  );
}
