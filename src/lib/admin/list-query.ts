/**
 * release-hardening F-341: shared client-side helpers for the admin
 * orders/customers/products list tables (OrdersTable, CustomersTable,
 * ProductsTable). Each one fires a fresh `/api/admin/...` request on every
 * filter change, so all three need the same three protections: debounce
 * the search box instead of firing on every keystroke, drop a response
 * that's no longer the latest one in flight (a slow, earlier request can
 * resolve after a faster, later one already has), and never even ask the
 * server to filter on a 1-character prefix.
 *
 * Extracted as plain functions (no React) so they're unit-testable with
 * node's test runner directly — this repo's unit tests run with no jsdom,
 * see src/components/admin/unsaved-changes.test.ts's file comment for the
 * same pattern.
 */

/** Debounces `fn`: each call to the returned function restarts the
 * `delayMs` timer, so only the *last* call in a burst of calls actually
 * runs `fn`, once that burst pauses for `delayMs`. `cancel()` drops any
 * pending call with nothing firing — call it on unmount so a component
 * that's already gone never has a stale debounced call run `setState`
 * against it. */
export interface Debounced<Args extends unknown[]> {
  (...args: Args): void;
  cancel(): void;
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delayMs: number): Debounced<Args> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  const debounced = ((...args: Args) => {
    if (handle !== null) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = null;
      fn(...args);
    }, delayMs);
  }) as Debounced<Args>;
  debounced.cancel = () => {
    if (handle !== null) {
      clearTimeout(handle);
      handle = null;
    }
  };
  return debounced;
}

/**
 * A monotonic "is this response still the one we want" guard. Call
 * `start()` right before firing a request and hold on to the id it
 * returns; once the response resolves, only apply it (setState) when
 * `isCurrent(id)` is still true. A slower, earlier request's response
 * (e.g. a "vol-" search resolving after "vol-heavy" already has — see the
 * F-341 finding's repro) comes back with a now-superseded id and is
 * dropped instead of overwriting the table with stale data.
 */
export interface LoadGuard {
  start(): number;
  isCurrent(id: number): boolean;
}

export function createLoadGuard(): LoadGuard {
  let latest = 0;
  return {
    start() {
      latest += 1;
      return latest;
    },
    isCurrent(id: number) {
      return id === latest;
    },
  };
}

/** F-341: below this many characters, a search box's value is treated as
 * empty (matches the unfiltered list) rather than sent to the server as a
 * `contains` filter — a 1-character prefix on a name/email/SKU column
 * matches a large share of the table, which is exactly the "typing 'v'
 * loads all 20,000 orders" failure the finding reproduces. */
export const MIN_SEARCH_CHARS = 2;

/** The value a table should actually query/filter with for a given raw
 * search-box value: the trimmed term, or "" (no filter) when it's shorter
 * than MIN_SEARCH_CHARS. */
export function normalizeSearchTerm(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length >= MIN_SEARCH_CHARS ? trimmed : "";
}
