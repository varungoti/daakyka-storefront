/**
 * Pure helpers behind MobileStickyAddToCart (kept free of React/imports so
 * they can be unit tested — see sticky-cta.test.ts).
 */

/** The slice of an IntersectionObserverEntry the visibility check reads. */
export interface CtaIntersection {
  isIntersecting: boolean;
  boundingClientRect: { bottom: number };
}

/**
 * F-025: the bar used to be `!entry.isIntersecting`, which is also true on
 * first paint when the CTA row is still *below* the fold — so on a phone the
 * bar slid up immediately, before the shopper had seen the size/colour
 * pickers, and one tap added the pre-selected variant unseen. It should only
 * appear once the row has scrolled past the top of the viewport: `bottom < 0`
 * (not `top < 0`, which is also true while the row is partly on screen).
 */
export function isCtaScrolledPast(entry: CtaIntersection): boolean {
  return !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
}

/**
 * "M · Navy": what the bar will add. The colour is only included when the
 * shopper can actually choose one (more than one colour), so a single-colour
 * product doesn't repeat its only colour next to the price.
 */
export function stickySelectionLabel(size: string, color: string, colorCount: number): string {
  return [size, colorCount > 1 ? color : ""].filter(Boolean).join(" · ");
}
