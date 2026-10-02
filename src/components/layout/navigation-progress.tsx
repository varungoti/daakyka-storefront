"use client";

import { isTrackableNavigationClick } from "@/lib/ui/navigation-click";
import {
  isNavigationPending,
  locationKey,
  settlePending,
  type PendingNavigation,
} from "@/lib/ui/navigation-progress";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

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
 *
 * It reads the query string as well as the path (a link that only changes the
 * query, such as the next page of orders, is a navigation too), and useSearchParams
 * makes a prerendered page client-render everything up to the nearest Suspense
 * boundary. The boundary is here, around only this bar, so nothing else is
 * affected, and the bar has nothing to show before the first tap, so its empty
 * fallback is exactly what it renders anyway. The boundary sits beside the page
 * rather than above it, so it does not change when a page's notFound() can still
 * turn the response into a 404.
 */
export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressBar />
    </Suspense>
  );
}

function NavigationProgressBar() {
  const currentKey = locationKey(usePathname(), useSearchParams());
  // The latest location, readable from the click listener below, which is
  // attached once and so cannot close over a changing value.
  const currentKeyRef = useRef(currentKey);
  useEffect(() => {
    currentKeyRef.current = currentKey;
  }, [currentKey]);

  // The navigation the shopper has started and that has not arrived yet.
  const [pending, setPending] = useState<PendingNavigation | null>(null);

  // Once the location has changed the navigation has arrived (or been replaced):
  // forget it, so Back to the page the tap started from does not bring the bar
  // back. Updating state while rendering is React's way of deriving state from a
  // changed value without an extra paint.
  const settled = settlePending(pending, currentKey);
  if (settled !== pending) setPending(settled);

  useEffect(() => {
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

      // A new object each time, so a second tap restarts the give-up timer.
      setPending({ from: currentKeyRef.current });
    };

    // Bubble phase on purpose: a handler that stops the click from propagating
    // (a button over a card's link) means no navigation, and never gets here.
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Stop showing progress if the location never changes (a redirect back to the
  // same page, a request that failed).
  useEffect(() => {
    if (pending === null) return;
    const giveUp = setTimeout(() => setPending(null), GIVE_UP_AFTER_MS);
    return () => clearTimeout(giveUp);
  }, [pending]);

  if (!isNavigationPending(pending, currentKey)) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[110] h-0.5 print:hidden">
      <div className="h-full animate-nav-progress bg-brand" />
    </div>
  );
}
