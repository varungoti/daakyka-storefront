/**
 * F-06 (docs/audit-2026-09-19/admin-ux.md): shared, framework-free
 * drag-and-drop reordering helpers for the category tree and product image
 * galleries — see category-tree.tsx, product-image-gallery.tsx, and
 * staged-product-image-gallery.tsx. No new dependency was added for this
 * (`package.json` is shared/contended right now, and neither the existing
 * deps nor this being a small, well-scoped need justified pulling one in):
 * drag-and-drop itself is native HTML5 drag events, and reordering is
 * expressed as a sequence of single-step moves.
 */

export type MoveDirection = "up" | "down";

/**
 * The sequence of single-step "swap with adjacent sibling" moves needed to
 * walk the item at `fromIndex` to `toIndex` — this is what lets
 * drag-and-drop reuse the *existing* single-step reorder endpoints
 * (`reorderCategory` / `reorderProductImages` in src/lib/catalog/
 * categories.ts and products.ts) instead of the app needing a second,
 * parallel "set absolute position" API: walking N adjacent swaps in the
 * same direction produces exactly the same final order as splicing the
 * item straight to its new index, since each step only ever swaps the
 * dragged item with whichever sibling now sits next to it.
 */
export function swapStepsForMove(fromIndex: number, toIndex: number): MoveDirection[] {
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [];
  const direction: MoveDirection = toIndex < fromIndex ? "up" : "down";
  const steps = Math.abs(toIndex - fromIndex);
  return Array.from({ length: steps }, () => direction);
}

/**
 * Splice-based reorder for a purely client-side array (no server round
 * trip) — used by the staged (not-yet-saved) product image gallery, whose
 * order isn't persisted anywhere until the product itself is created (see
 * src/lib/admin/staged-images.ts). Out-of-range or no-op indices return the
 * same array reference unchanged, matching moveStagedImage's existing
 * no-op convention.
 */
export function moveArrayItem<T>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= list.length ||
    toIndex < 0 ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return list as T[];
  }
  const next = list.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}
