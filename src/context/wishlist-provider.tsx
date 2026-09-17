"use client";

import type { Product } from "@/lib/types";
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

interface WishlistContextValue {
  items: Product[];
  count: number;
  isOpen: boolean;
  openWishlist: () => void;
  closeWishlist: () => void;
  toggleWishlist: (product: Product) => void;
  removeFromWishlist: (productId: string) => void;
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

  const toggleWishlist = useCallback((product: Product) => {
    setWishlistItems((current) => {
      const exists = current.some((item) => item.id === product.id);
      if (exists) {
        return current.filter((item) => item.id !== product.id);
      }
      return [...current, product];
    });
  }, []);

  const removeFromWishlist = useCallback((productId: string) => {
    setWishlistItems((current) => current.filter((item) => item.id !== productId));
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
      isWishlisted,
    }),
    [items, isOpen, isWishlisted, removeFromWishlist, toggleWishlist],
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
