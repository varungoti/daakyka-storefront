import type { SearchProduct } from "@/lib/products/public-search-product";

/**
 * F-013: the header search dialog's product index — downloaded once per page
 * session instead of on every open. The dialog is always mounted (it lives in
 * the header), but its effect used to re-run `fetch("/api/products")` each
 * time it opened and showed "Searching..." for the whole round trip, even
 * though the previous open's products were still in memory.
 *
 * One shared promise, so a hover/focus preload (`preloadSearchIndex`), the
 * dialog's own open and a StrictMode double effect all become one request. A
 * failed request is forgotten, so the next open retries instead of keeping an
 * empty list for the rest of the session.
 */

const SEARCH_INDEX_URL = "/api/products";

type FetchLike = (input: string) => Promise<Pick<Response, "ok" | "json">>;

let pending: Promise<SearchProduct[]> | null = null;
let loaded: SearchProduct[] | null = null;

export function loadSearchIndex(fetchImpl: FetchLike = (input) => fetch(input)): Promise<SearchProduct[]> {
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;

  const request = fetchImpl(SEARCH_INDEX_URL)
    .then(async (response) => {
      if (!response.ok) throw new Error("Search index request failed");
      const data = (await response.json()) as { products?: SearchProduct[] };
      loaded = Array.isArray(data.products) ? data.products : [];
      return loaded;
    })
    .finally(() => {
      pending = null;
    });
  pending = request;
  return request;
}

/** The index if an earlier call already finished downloading it, else
 * `null` — lets the dialog render results on the very first frame of an open
 * instead of a "Searching..." flash while an already-resolved promise's
 * `then` is still queued. */
export function peekSearchIndex(): SearchProduct[] | null {
  return loaded;
}

/** Starts the download ahead of the first open (header Search button hover /
 * focus). Never throws: a failed preload just means the open retries. */
export function preloadSearchIndex(): void {
  void loadSearchIndex().catch(() => {});
}

/** Test seam: forget everything, as if the page had just loaded. */
export function resetSearchIndexForTests(): void {
  pending = null;
  loaded = null;
}
