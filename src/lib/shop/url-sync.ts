import { applyShopFiltersToSearchParams, type ShopFilters } from "@/lib/shop/filters";

/**
 * F-018: /shop and /category/[slug] are prerendered now, so the server no
 * longer sees `?category=`/`?q=`/facets. ShopPageContent applies the URL after
 * hydration instead, reading it through `useSearchParams()` in an isolated
 * Suspense boundary (see ShopUrlSync there) and keeping its own filter state
 * so a click filters the grid on the same frame.
 *
 * That state is also what the page writes to the URL (history.pushState /
 * replaceState, which Next syncs into `useSearchParams`) — and Next reports
 * each write back a render later, in order. While a shopper types in the search
 * box or toggles facets quickly, an echo of an EARLIER write can arrive after
 * the state has moved on, and applying it would reset the input to what it
 * was a keystroke ago (and drop a space typed between two words). The guard
 * lets the page recognise those echoes of its own writes and ignore them,
 * while a real navigation (a search-dialog or menu link to /shop?q=..., which
 * the page did not write) is applied.
 */

/** How long after one of its own writes the page treats a URL change that
 * does not match that write as a lagging echo rather than a navigation. */
export const OWN_WRITE_ECHO_WINDOW_MS = 1500;

function canonicalSearch(search: string): string {
  return new URLSearchParams(search).toString();
}

export interface UrlEchoGuard {
  /** Call right after the page wrote `search` to the URL. */
  noteOwnWrite(search: string): void;
  /** Whether a URL change reported by the router, with query string
   * `search`, is just the echo of the page's own latest (or an earlier) write
   * and must not be applied back onto the page's state. */
  isEcho(search: string): boolean;
  /** Forget any pending write — e.g. on back/forward, whose URL is applied
   * directly and is final. */
  reset(): void;
}

export function createUrlEchoGuard(now: () => number = Date.now): UrlEchoGuard {
  let pending: { search: string; expiresAt: number } | null = null;

  return {
    noteOwnWrite(search) {
      pending = { search: canonicalSearch(search), expiresAt: now() + OWN_WRITE_ECHO_WINDOW_MS };
    },
    isEcho(search) {
      if (!pending) return false;
      if (now() >= pending.expiresAt) {
        pending = null;
        return false;
      }
      // The echo of the latest write has arrived: the router has caught up.
      // Anything else inside the window is an echo of an earlier write.
      if (canonicalSearch(search) === pending.search) pending = null;
      return true;
    },
    reset() {
      pending = null;
    },
  };
}

/** Whether two filter sets would produce the same URL — the check that lets
 * the page keep its current state object (and so the product grid keep its
 * "Load more" position) when a URL change carries nothing new. */
export function sameShopFilters(a: ShopFilters, b: ShopFilters): boolean {
  return (
    applyShopFiltersToSearchParams("", a, "").toString() ===
    applyShopFiltersToSearchParams("", b, "").toString()
  );
}
