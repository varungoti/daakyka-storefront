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
}

export function addStagedImage(list: readonly StagedImage[], image: StagedImage): StagedImage[] {
  return [...list, image];
}

export function addStagedImages(list: readonly StagedImage[], images: readonly StagedImage[]): StagedImage[] {
  return [...list, ...images];
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
