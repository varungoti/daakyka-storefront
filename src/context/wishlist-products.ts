"use client";

import { useWishlist } from "@/context/wishlist-provider";
import type { SearchProduct } from "@/lib/products/public-search-product";
import { peekSearchIndex, refreshSearchIndex } from "@/lib/search/search-index";
import { resolveWishlist, type ResolvedWishlist } from "@/lib/wishlist/live-products";
import { useEffect, useMemo, useRef, useState } from "react";

/** `loading` until a fresh copy of the catalogue has arrived, `error` if it
 * could not be fetched and there is nothing to show instead, else `ready`. */
export type WishlistProductsStatus = "loading" | "ready" | "error";

/**
 * F-113: the wishlist's rows with their live data — current price, MRP, photo,
 * name, availability — read from the catalogue every time the wishlist is
 * shown, instead of a copy saved when the heart was tapped.
 *
 * Mount it only while the list is on screen (the drawer's content, the account
 * tab): each mount downloads a fresh copy. Whatever copy an earlier download
 * left behind is shown meanwhile, and rows it does not cover — a product
 * hearted since — appear as soon as the fresh copy lands. Entries the fresh
 * copy confirms are gone (archived or deleted products) are dropped from the
 * saved list for good; see resolveWishlist for when that is and isn't allowed.
 */
export function useWishlistProducts(): {
  rows: ResolvedWishlist["rows"];
  status: WishlistProductsStatus;
} {
  const { items, removeManyFromWishlist } = useWishlist();
  const [state, setState] = useState<{ catalogue: SearchProduct[] | null; fresh: boolean; failed: boolean }>(
    () => ({ catalogue: peekSearchIndex(), fresh: false, failed: false }),
  );
  // The entries at the moment the download starts: only those can be judged
  // missing by it. A product hearted while it was in flight is not in that
  // snapshot, so a catalogue that predates it can never drop it.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  const hasItems = items.length > 0;
  useEffect(() => {
    if (!hasItems) return;
    let cancelled = false;
    const entriesAtStart = itemsRef.current;
    refreshSearchIndex()
      .then((catalogue) => {
        // Dropping gone products does not depend on this component still being
        // mounted — the answer is true whichever screen asked.
        removeManyFromWishlist(resolveWishlist(entriesAtStart, catalogue).missingIds);
        if (!cancelled) setState({ catalogue, fresh: true, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, failed: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [hasItems, removeManyFromWishlist]);

  const rows = useMemo(() => resolveWishlist(items, state.catalogue).rows, [items, state.catalogue]);

  let status: WishlistProductsStatus = "loading";
  if (!hasItems || state.fresh || (state.failed && state.catalogue)) status = "ready";
  else if (state.failed) status = "error";

  return { rows, status };
}
