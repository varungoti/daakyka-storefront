import type { Product } from "@/lib/types";

const STORAGE_KEY = "daakyka-wishlist";
const EMPTY_ITEMS: Product[] = [];

let cachedItems: Product[] = EMPTY_ITEMS;
let hydrated = false;
const listeners = new Set<() => void>();

function loadFromStorage(): Product[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return EMPTY_ITEMS;
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as Product[]) : EMPTY_ITEMS;
  } catch {
    return EMPTY_ITEMS;
  }
}

function persist(items: Product[]) {
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
export function getWishlistSnapshot(): Product[] {
  if (!hydrated) {
    cachedItems = loadFromStorage();
    hydrated = true;
  }
  return cachedItems;
}

export function getServerWishlistSnapshot(): Product[] {
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
  updater: Product[] | ((current: Product[]) => Product[]),
): void {
  const next = typeof updater === "function" ? updater(getWishlistSnapshot()) : updater;
  cachedItems = next;
  hydrated = true;
  persist(next);
  emitChange();
}
