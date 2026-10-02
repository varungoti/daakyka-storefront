/**
 * F-091: the state rules of the top progress bar, pulled out of
 * NavigationProgress so they can be tested without a browser.
 *
 * A "location" is the path plus the query string: isTrackableNavigationClick
 * counts a link that only changes the query (`/shop?page=1` to `?page=2`) as a
 * navigation, so finishing one has to be recognised by the query changing too —
 * watching the path alone left the bar up until its give-up timer.
 *
 * Both sides of every comparison come from the router's own hooks, never from
 * `window.location`, so the two can never disagree about how a path or query is
 * written (encoding, trailing slash).
 */
export interface PendingNavigation {
  /** The location the shopper tapped away from. */
  readonly from: string;
}

/** A stable key for a location: `/shop`, or `/shop?page=2`. */
export function locationKey(
  pathname: string | null | undefined,
  searchParams: { toString(): string } | null | undefined,
): string {
  const search = searchParams ? searchParams.toString() : "";
  return `${pathname ?? ""}${search ? `?${search}` : ""}`;
}

/** The bar shows while the page the shopper tapped away from is still the page
 * on screen. */
export function isNavigationPending(pending: PendingNavigation | null, currentKey: string): boolean {
  return pending !== null && pending.from === currentKey;
}

/**
 * What is still pending once the location is `currentKey`: the same navigation
 * while the old page is still showing, nothing once the location has changed.
 * The navigation must be dropped then, not just hidden — otherwise pressing Back
 * to the page the tap started from would show the bar again.
 */
export function settlePending(pending: PendingNavigation | null, currentKey: string): PendingNavigation | null {
  return isNavigationPending(pending, currentKey) ? pending : null;
}
