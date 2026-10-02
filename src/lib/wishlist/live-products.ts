import type { SearchProduct } from "@/lib/products/public-search-product";
import type { WishlistEntry } from "@/lib/wishlist/entries";

/**
 * F-113: what a wishlist row shows, taken from the live catalogue (the same
 * CDN-cached index the header search uses — see public-search-product.ts)
 * rather than from a copy saved when the heart was tapped.
 */
export type WishlistProduct = Pick<
  SearchProduct,
  "id" | "handle" | "name" | "colorName" | "price" | "compareAtPrice" | "image" | "available" | "category"
>;

export function toWishlistProduct(product: SearchProduct): WishlistProduct {
  return {
    id: product.id,
    handle: product.handle,
    name: product.name,
    colorName: product.colorName,
    price: product.price,
    compareAtPrice: product.compareAtPrice,
    image: product.image,
    available: product.available,
    category: product.category,
  };
}

export interface ResolvedWishlist {
  /** One per saved entry, in wishlist order. `product` is null when the
   * catalogue in hand does not describe the entry: it has not loaded yet, could
   * not be read, is empty, or the product is gone (see `missingIds`). */
  rows: { entry: WishlistEntry; product: WishlistProduct | null }[];
  /** Ids the live catalogue confirms are gone (archived, deleted or no longer
   * on sale) — safe to drop from the saved list. */
  missingIds: string[];
}

/**
 * Matches saved entries to the live catalogue. An entry is matched by `id`
 * (stable) and, failing that, by `handle`; a product whose slug the admin
 * renamed therefore keeps its place and links to its current address.
 *
 * `missingIds` is empty whenever the catalogue came back empty (or not at
 * all): an empty list is what a store with its catalogue switched off, or a
 * failed read, looks like, and that must never wipe every shopper's saved
 * items — only a catalogue that has products and lacks *this* one proves the
 * product is gone.
 */
export function resolveWishlist(entries: WishlistEntry[], catalogue: SearchProduct[] | null): ResolvedWishlist {
  if (!catalogue || catalogue.length === 0) {
    return { rows: entries.map((entry) => ({ entry, product: null })), missingIds: [] };
  }

  const byId = new Map<string, SearchProduct>();
  const byHandle = new Map<string, SearchProduct>();
  for (const product of catalogue) {
    byId.set(product.id, product);
    byHandle.set(product.handle, product);
  }

  const rows: ResolvedWishlist["rows"] = [];
  const missingIds: string[] = [];
  for (const entry of entries) {
    const live = byId.get(entry.id) ?? byHandle.get(entry.handle);
    rows.push({ entry, product: live ? toWishlistProduct(live) : null });
    if (!live) missingIds.push(entry.id);
  }
  return { rows, missingIds };
}

/** A readable stand-in name for an entry the catalogue could not describe:
 * "womens-vneck-scrub-top" becomes "Womens vneck scrub top". Only used when
 * the live data is unavailable — the row still links and can be removed. */
export function nameFromHandle(handle: string): string {
  const words = handle.replace(/[-_]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : handle;
}
