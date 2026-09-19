import type { ProductImageRow } from "@/components/admin/product-image-gallery";
import type { StagedImage } from "@/lib/admin/staged-images";

/**
 * Release-hardening F-04 (docs/audit-2026-09-19/admin-ux.md): links every
 * staged (already-uploaded/generated, not-yet-attached) image to a product
 * right after it's created — see product-form.tsx's `saveDraft()`, which is
 * the only caller. Pure orchestration (no `fetch`, no DOM): the actual HTTP
 * call is injected via `deps.attach`, so this is unit-testable end-to-end
 * with a fake (see attach-staged-images.test.ts) without a browser or a
 * real server.
 *
 * Deliberately tolerant of a per-image failure rather than all-or-nothing:
 * the product itself already saved successfully by the time this runs, and
 * every staged image is a real, already-persisted `MediaAsset` — an admin
 * losing the *product* because one *photo* failed to attach would be a much
 * worse outcome than the product simply having fewer photos than expected.
 * Order is preserved for whichever images succeed, matching
 * `addProductImage`'s own append-at-end `sortOrder` behavior (src/lib/catalog/products.ts)
 * since each attach call only resolves after the previous one's row (and
 * therefore its sortOrder) has been created.
 */

export interface AttachStagedImagesResult {
  attached: ProductImageRow[];
  failed: StagedImage[];
}

export interface AttachStagedImagesDeps {
  /** Resolves to the created ProductImageRow on success, or `null` on any
   * failure (a non-2xx response, a network error, etc.) — never throws, so
   * the loop below can keep going through the rest of the batch. */
  attach: (productId: string, image: StagedImage) => Promise<ProductImageRow | null>;
}

export async function attachStagedImages(
  productId: string,
  stagedImages: readonly StagedImage[],
  deps: AttachStagedImagesDeps,
): Promise<AttachStagedImagesResult> {
  const attached: ProductImageRow[] = [];
  const failed: StagedImage[] = [];

  for (const staged of stagedImages) {
    const row = await deps.attach(productId, staged);
    if (row) {
      attached.push(row);
    } else {
      failed.push(staged);
    }
  }

  return { attached, failed };
}
