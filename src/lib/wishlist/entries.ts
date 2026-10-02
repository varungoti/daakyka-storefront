/**
 * F-113: what the browser keeps for a wishlisted product — an id and a handle,
 * nothing else. The wishlist used to store the whole `Product` object (about
 * 5 KB each, with every variant and the full description), so the drawer and
 * the account tab kept showing the price, photo and name from the day the heart
 * was tapped: a price change or sale never appeared, a replaced photo never
 * changed, and an archived product stayed listed and linked to a 404. Display
 * data now comes from the live catalogue (see live-products.ts) every time the
 * wishlist is shown.
 *
 * Pure (no `window`, no React) so a test can drive it directly.
 */
export interface WishlistEntry {
  id: string;
  handle: string;
}

/**
 * Turns whatever `localStorage` holds into entries. Also migrates the old
 * full-snapshot format in place: an element keeps only its `id` and `handle`,
 * so a snapshot saved before this change stops carrying (and showing) its old
 * price the first time the wishlist is read.
 *
 * Skips anything that is not an object with a non-empty string `id` and
 * `handle`, and keeps the first of any duplicate id. `changed` is true when the
 * result differs from what was stored, so the caller knows to write the
 * migrated form back.
 */
export function normalizeStoredWishlist(parsed: unknown): { items: WishlistEntry[]; changed: boolean } {
  if (!Array.isArray(parsed)) return { items: [], changed: parsed !== undefined && parsed !== null };

  const items: WishlistEntry[] = [];
  const seen = new Set<string>();
  let changed = false;

  for (const element of parsed) {
    const candidate = element as { id?: unknown; handle?: unknown } | null;
    const id = typeof candidate?.id === "string" ? candidate.id : "";
    const handle = typeof candidate?.handle === "string" ? candidate.handle : "";
    if (!id || !handle || seen.has(id)) {
      changed = true;
      continue;
    }
    seen.add(id);
    items.push({ id, handle });
    if (Object.keys(candidate as object).length !== 2) changed = true;
  }

  return { items, changed };
}

/**
 * Adds the product to the saved list, or removes it if it is already there.
 * Whatever else the caller's object carries (a full `Product` is what the
 * heart buttons hold) is not kept — only `{ id, handle }`.
 */
export function toggleWishlistEntry(current: WishlistEntry[], product: WishlistEntry): WishlistEntry[] {
  if (current.some((item) => item.id === product.id)) {
    return current.filter((item) => item.id !== product.id);
  }
  return [...current, { id: product.id, handle: product.handle }];
}
