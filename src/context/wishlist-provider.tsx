"use client";

import type { Product } from "@/lib/types";
import { toggleWishlistEntry, type WishlistEntry } from "@/lib/wishlist/entries";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  getServerWishlistSnapshot,
  getWishlistSnapshot,
  setWishlistItems,
  subscribeToWishlist,
} from "@/context/wishlist-store";

/** What toggling needs from a product: only its id and handle are kept (F-113);
 * a full `Product` satisfies this. */
type WishlistableProduct = Pick<Product, "id" | "handle">;

interface WishlistContextValue {
  /** Saved entries — id and handle only. What to show for them (name, photo,
   * price, availability) comes from the live catalogue: see
   * useWishlistProducts. */
  items: WishlistEntry[];
  count: number;
  isOpen: boolean;
  openWishlist: () => void;
  closeWishlist: () => void;
  toggleWishlist: (product: WishlistableProduct) => void;
  removeFromWishlist: (productId: string) => void;
  /** Drops several entries at once (products the catalogue no longer has). */
  removeManyFromWishlist: (productIds: readonly string[]) => void;
  isWishlisted: (productId: string) => boolean;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(
    subscribeToWishlist,
    getWishlistSnapshot,
    getServerWishlistSnapshot,
  );
  const [isOpen, setIsOpen] = useState(false);

  const toggleWishlist = useCallback((product: WishlistableProduct) => {
    setWishlistItems((current) => toggleWishlistEntry(current, product));
  }, []);

  const removeFromWishlist = useCallback((productId: string) => {
    setWishlistItems((current) => current.filter((item) => item.id !== productId));
  }, []);

  const removeManyFromWishlist = useCallback((productIds: readonly string[]) => {
    if (productIds.length === 0) return;
    const gone = new Set(productIds);
    setWishlistItems((current) => {
      const next = current.filter((item) => !gone.has(item.id));
      // Same array back when nothing matched, so a no-op does not re-render.
      return next.length === current.length ? current : next;
    });
  }, []);

  const isWishlisted = useCallback(
    (productId: string) => items.some((item) => item.id === productId),
    [items],
  );

  const value = useMemo(
    () => ({
      items,
      count: items.length,
      isOpen,
      openWishlist: () => setIsOpen(true),
      closeWishlist: () => setIsOpen(false),
      toggleWishlist,
      removeFromWishlist,
      removeManyFromWishlist,
      isWishlisted,
    }),
    [items, isOpen, isWishlisted, removeFromWishlist, removeManyFromWishlist, toggleWishlist],
  );

  return (
    <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) {
    throw new Error("useWishlist must be used within WishlistProvider");
  }
  return context;
}
