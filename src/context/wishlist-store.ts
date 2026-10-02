import { normalizeStoredWishlist, type WishlistEntry } from "@/lib/wishlist/entries";

const STORAGE_KEY = "daakyka-wishlist";
const EMPTY_ITEMS: WishlistEntry[] = [];

let cachedItems: WishlistEntry[] = EMPTY_ITEMS;
let hydrated = false;
const listeners = new Set<() => void>();

function loadFromStorage(): WishlistEntry[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return EMPTY_ITEMS;
    const { items, changed } = normalizeStoredWishlist(JSON.parse(stored) as unknown);
    // F-113: a list saved before the wishlist kept only id + handle holds a
    // full product copy per item (about 5 KB each, with a price that never
    // updates) — write the slim form back so that data is not kept around.
    if (changed) persist(items);
    return items.length > 0 ? items : EMPTY_ITEMS;
  } catch {
    return EMPTY_ITEMS;
  }
}

function persist(items: WishlistEntry[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage can throw (private browsing, quota). The in-memory
    // store still reflects the change for the rest of this page view.
  }
}

function emitChange() {
  for (const listener of listeners) listener();
}

/**
 * Snapshot for useSyncExternalStore. Lazily hydrates from localStorage on
 * first read (client only) and thereafter returns the cached reference so
 * React can bail out when nothing changed.
 */
export function getWishlistSnapshot(): WishlistEntry[] {
  if (!hydrated) {
    cachedItems = loadFromStorage();
    hydrated = true;
  }
  return cachedItems;
}

export function getServerWishlistSnapshot(): WishlistEntry[] {
  return EMPTY_ITEMS;
}

export function subscribeToWishlist(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  const onStorageEvent = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      hydrated = false;
      onStoreChange();
    }
  };
  window.addEventListener("storage", onStorageEvent);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStorageEvent);
  };
}

export function setWishlistItems(
  updater: WishlistEntry[] | ((current: WishlistEntry[]) => WishlistEntry[]),
): void {
  const next = typeof updater === "function" ? updater(getWishlistSnapshot()) : updater;
  cachedItems = next;
  hydrated = true;
  persist(next);
  emitChange();
}
