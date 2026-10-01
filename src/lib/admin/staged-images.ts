/**
 * Release-hardening F-04 (docs/audit-2026-09-19/admin-ux.md): pure array
 * helpers for the "staged" image list a brand-new, not-yet-saved product
 * form keeps client-side — see src/components/admin/staged-product-image-gallery.tsx
 * for the UI and src/components/admin/product-form.tsx for how the staged
 * list gets attached to the product once it's actually created.
 *
 * A `StagedImage` always refers to an already-uploaded/already-generated
 * `MediaAsset` (via `/api/admin/media` or `/api/admin/media/generate` —
 * the exact same pipeline `saveMediaAsset`/`generateImage` back, reused
 * as-is) that simply hasn't been linked to a product yet (no `ProductImage`
 * row exists for it). That's why these helpers never touch the network —
 * staging/unstaging/reordering/re-tagging is pure client array bookkeeping
 * against data that's already durably stored; only *attaching* (see
 * attach-staged-images.ts) or *deleting* (the "Remove" button, which calls
 * DELETE /api/admin/media/[id] directly — see
 * staged-product-image-gallery.tsx) talks to the server.
 *
 * Kept framework-free and side-effect-free on purpose so it's trivially
 * unit-testable without a browser (see staged-images.test.ts) and safely
 * reusable from the component's event handlers.
 */

export interface StagedImage {
  /** The MediaAsset id — this IS the identity of a staged image, since
   * there's no ProductImage row (and therefore no ProductImage id) until
   * attach time. */
  mediaAssetId: string;
  url: string;
  alt: string;
  color: string | null;
  /**
   * F-07 (docs/audit-2026-09-19/admin-ux.md): distinguishes a photo this
   * session freshly uploaded/generated (`"new"`, the default — matches
   * every staged image before F-07) from one picked from the shared media
   * library (`"library"`). Both are equally real, already-persisted
   * `MediaAsset` rows, but "Remove" needs to treat them differently: a
   * fresh upload that's abandoned before saving the product should be
   * deleted outright (see StagedProductImageGallery's `remove()`, and
   * deleteUnattachedMediaAsset's file comment in
   * src/lib/media/store.ts), while unstaging a *reused* library asset must
   * never delete it — that asset may already be attached to other
   * products, or simply belongs in the library for later reuse regardless
   * of this particular draft.
   */
  origin?: "new" | "library";
}

export function addStagedImage(list: readonly StagedImage[], image: StagedImage): StagedImage[] {
  return [...list, image];
}

export function addStagedImages(list: readonly StagedImage[], images: readonly StagedImage[]): StagedImage[] {
  return [...list, ...images];
}

/**
 * F-192: stages every asset picked in one media-library "Add N images"
 * confirm (or the single-pick fallback, as a one-element array) and returns
 * the whole new list, so the caller makes exactly *one* `onChange` call per
 * batch. Calling `onChange(addStagedImage(images, ...))` once per picked
 * asset would rebuild each list from the same `images` prop the handler
 * closed over, and the parent's setState would keep only the last pick —
 * the same trap ProductImageGallery's `attachPicksSequentially` guards
 * against.
 *
 * Skips any asset whose id is already staged (or repeated within `assets`):
 * `mediaAssetId` is a staged image's identity (and its React key), so a
 * duplicate would make remove/update/reorder hit both copies, and "Remove"
 * on a fresh upload re-picked from the library would delete the asset the
 * other copy still points at.
 */
export function stageLibraryAssets(
  list: readonly StagedImage[],
  assets: readonly { id: string; url: string; alt: string | null }[],
  fallbackAlt: string,
): StagedImage[] {
  const seen = new Set(list.map((img) => img.mediaAssetId));
  const added: StagedImage[] = [];
  for (const asset of assets) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    added.push({ mediaAssetId: asset.id, url: asset.url, alt: asset.alt ?? fallbackAlt, color: null, origin: "library" });
  }
  return addStagedImages(list, added);
}

export function removeStagedImage(list: readonly StagedImage[], mediaAssetId: string): StagedImage[] {
  return list.filter((img) => img.mediaAssetId !== mediaAssetId);
}

export function updateStagedImage(
  list: readonly StagedImage[],
  mediaAssetId: string,
  patch: Partial<Omit<StagedImage, "mediaAssetId">>,
): StagedImage[] {
  return list.map((img) => (img.mediaAssetId === mediaAssetId ? { ...img, ...patch } : img));
}

/** Swaps a staged image with its previous/next sibling — mirrors the saved
 * gallery's up/down reorder (see reorderProductImages in
 * src/lib/catalog/products.ts), but purely local since sort order isn't
 * persisted anywhere until attach time (attaching walks the staged array
 * in order and that order becomes each row's sortOrder). No-op (returns
 * the same array reference) at either end of the list or for an unknown id. */
export function moveStagedImage(
  list: readonly StagedImage[],
  mediaAssetId: string,
  direction: "up" | "down",
): StagedImage[] {
  const index = list.findIndex((img) => img.mediaAssetId === mediaAssetId);
  if (index === -1) return list as StagedImage[];

  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= list.length) return list as StagedImage[];

  const next = list.slice();
  [next[index], next[swapWith]] = [next[swapWith], next[index]];
  return next;
}
