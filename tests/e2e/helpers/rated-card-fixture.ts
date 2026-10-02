/**
 * The review rating a product card shows on a phone (`<StarRating condenseOnPhone>`,
 * 4.5 stars, 135 reviews), as HTML, for tests/e2e/mobile-layout.spec.ts to add to
 * cards on a catalogue that has no approved reviews.
 *
 * It lives here as a string, not as a rendered React component, because
 * Playwright's own TypeScript transform compiles JSX in anything a spec imports
 * as component-test JSX, which can't be rendered with react-dom. The unit test
 * src/components/ui/star-rating.test.ts renders the real component and fails
 * if its output stops matching this string (apart from the star outline's path
 * data, which has no effect on layout), so the spec cannot drift from the
 * production markup. A three-digit review count is the widest realistic one.
 */
const star = (extraClass: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star fill-amber-400 text-amber-400${extraClass}" aria-hidden="true"></svg>`;

export const CONDENSED_RATING_HTML =
  `<div class="flex items-center gap-1.5">` +
  `<div class="flex items-center gap-0.5 max-sm:hidden">${star("").repeat(5)}</div>` +
  star(" sm:hidden") +
  `<span class="text-sm font-medium text-ink max-sm:text-xs">4.5</span>` +
  `<span class="text-sm text-muted max-sm:text-xs">(135)</span>` +
  `</div>`;
