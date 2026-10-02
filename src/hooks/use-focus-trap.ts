"use client";

import { useEffect, useRef } from "react";

// `:not([tabindex="-1"])` on every entry, not just the last: an element that
// is focusable but deliberately out of the Tab order (an `<a tabIndex={-1}>`
// listbox option, say) must never be picked as the first/last stop, or Tab
// from the real last stop would never wrap.
const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Shared focus-trap behavior for dialogs/drawers/menus: while `open`,
 * traps Tab/Shift+Tab focus inside the returned container ref, closes on
 * Escape, locks body scroll, and restores focus to whatever was focused
 * before opening (or `restoreFocusRef`, when given — e.g. the hamburger
 * button that opened a mobile nav drawer) once closed.
 *
 * Mirrors the inline pattern already used by
 * src/components/admin/admin-shell.tsx's MobileNavDrawer, pulled out here
 * so the storefront header's mobile drawer (and any future dialog, e.g.
 * the Phase C4 image lightbox) can reuse it instead of re-implementing
 * the same key handling.
 */
export function useFocusTrap<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  options?: { restoreFocusRef?: React.RefObject<HTMLElement | null>; lockScroll?: boolean },
) {
  const containerRef = useRef<T>(null);
  const lockScroll = options?.lockScroll ?? true;

  useEffect(() => {
    if (!open) return;

    const container = containerRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const getFocusable = () => container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);

    // Move focus into the container as soon as it opens.
    const first = getFocusable()?.[0];
    (first ?? container)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const items = getFocusable();
      if (!items || items.length === 0) return;

      const firstEl = items[0];
      const lastEl = items[items.length - 1];

      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      // F-238: a `previouslyFocused` that is inside the container (an
      // `autoFocus`ed field, which React focuses during commit — before
      // this effect runs) is not where the user came from, and it is about
      // to be unmounted; restoring to it silently drops focus to <body>.
      const restoreTo =
        options?.restoreFocusRef?.current ??
        (previouslyFocused && !container?.contains(previouslyFocused) ? previouslyFocused : null);
      restoreTo?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose/options identity churn is fine to ignore here
  }, [open]);

  return containerRef;
}
