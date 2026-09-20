import { randomUUID } from "node:crypto";
import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import type { MediaAsset, MediaSource, MediaUsage } from "@/generated/prisma/client";
import { MEDIA_CACHE_TAG } from "@/lib/media/get-site-image";
import { processImage } from "@/lib/media/process-image";
import {
  deleteObject,
  isR2Configured,
  publicUrlForKey,
  uploadObject,
} from "@/lib/storage/r2";

/**
 * The subset of the storage lib that `saveMediaAsset` needs. Real callers
 * get the default (real R2) implementation; tests inject an in-memory fake
 * so they never make a real network call and can run without R2
 * credentials configured.
 */
export interface StorageDeps {
  isConfigured: () => boolean;
  upload: (key: string, body: Buffer, contentType: string) => Promise<void>;
  publicUrl: (key: string) => string;
  /** Optional so every existing `StorageDeps` literal (upload-only fakes in
   * tests/integration/media.test.ts, scripts/generate-images.ts) keeps
   * compiling unchanged. Only `deleteUnattachedMediaAsset` below reads it. */
  remove?: (key: string) => Promise<void>;
}

export const defaultStorageDeps: StorageDeps = {
  isConfigured: isR2Configured,
  upload: uploadObject,
  publicUrl: publicUrlForKey,
  remove: deleteObject,
};

export class StorageNotConfiguredForMediaError extends Error {
  constructor() {
    super("Cloudflare R2 storage is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET and R2_PUBLIC_BASE_URL");
    this.name = "StorageNotConfiguredForMediaError";
  }
}

export interface SaveMediaAssetInput {
  buffer: Buffer;
  usage: MediaUsage;
  source: MediaSource;
  alt?: string;
  prompt?: string;
  model?: string;
  slot?: string;
  createdById?: string;
}

function objectKeyFor(usage: MediaUsage): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = randomUUID();
  return `media/${usage.toLowerCase()}/${yyyy}/${mm}/${id}.webp`;
}

/**
 * Processes a raw image buffer (EXIF-rotated, stripped, resized, WebP),
 * uploads it to R2, and records it as a `MediaAsset` row. This is the one
 * place both the upload API route and the AI generation flow go through,
 * so every stored image gets the same treatment regardless of origin.
 */
export async function saveMediaAsset(
  input: SaveMediaAssetInput,
  storage: StorageDeps = defaultStorageDeps,
): Promise<MediaAsset> {
  if (!storage.isConfigured()) {
    throw new StorageNotConfiguredForMediaError();
  }

  // `MediaAsset.slot` is @unique — a slotted asset (manifest site images,
  // Phase E2) can be "replaced" (re-uploaded or regenerated) any number of
  // times, so clear out whatever previously held this slot first instead
  // of letting the create() below hit a unique-constraint violation. The
  // old R2 object is removed best-effort; a failure there (e.g. R2
  // transiently unavailable) must not block publishing the new image.
  if (input.slot) {
    const existing = await db.mediaAsset.findUnique({ where: { slot: input.slot } });
    if (existing) {
      try {
        await deleteObject(existing.key);
      } catch {
        // Best-effort cleanup only — an orphaned R2 object is a much
        // smaller problem than failing the replace entirely.
      }
      await db.mediaAsset.delete({ where: { id: existing.id } });
    }
  }

  const processed = await processImage(input.buffer);
  const key = objectKeyFor(input.usage);

  await storage.upload(key, processed.buffer, processed.contentType);
  const url = storage.publicUrl(key);

  const asset = await db.mediaAsset.create({
    data: {
      key,
      url,
      alt: input.alt,
      width: processed.width,
      height: processed.height,
      source: input.source,
      prompt: input.prompt,
      model: input.model,
      usage: input.usage,
      slot: input.slot,
      createdById: input.createdById,
    },
  });

  if (input.slot) {
    try {
      // "max": the recommended profile (see next/cache's revalidateTag
      // docs) — stale-while-revalidate, matching the settings module's
      // SETTINGS_CACHE_TAG invalidation in src/lib/settings/index.ts.
      revalidateTag(MEDIA_CACHE_TAG, "max");
    } catch {
      // No static generation store in this context (unit tests, scripts,
      // the fake-storage integration tests) — nothing to revalidate.
    }
  }

  return asset;
}

// ---------------------------------------------------------------------------
// Deleting an unattached asset (F-04 orphan cleanup)
// ---------------------------------------------------------------------------

export class MediaAssetNotFoundError extends Error {
  constructor(id: string) {
    super(`Media asset ${id} not found`);
    this.name = "MediaAssetNotFoundError";
  }
}

export class MediaAssetAttachedError extends Error {
  constructor() {
    super("This image is attached to a product — remove it from the product instead of deleting it here.");
    this.name = "MediaAssetAttachedError";
  }
}

export class MediaAssetInUseError extends Error {
  constructor() {
    super("This image is a managed site image and can't be deleted here — replace it from the Media Library instead.");
    this.name = "MediaAssetInUseError";
  }
}

/**
 * Deletes a `MediaAsset` that nothing references yet (R2 object + DB row).
 *
 * This exists for the F-04 single-pass product creation flow (see
 * docs/audit-2026-09-19/admin-ux.md, and product-form.tsx /
 * staged-product-image-gallery.tsx for the caller): an admin can now
 * upload or AI-generate a product photo *before* the product itself has
 * been saved, via the exact same `saveMediaAsset`/`generateImage` pipeline
 * as every other image — which means a "staged" photo is a real
 * `MediaAsset` row (and a real R2 object) from the moment it's added, not
 * a browser-only draft. If the admin removes it from the staging gallery
 * before saving, or never saves the product at all, that row would
 * otherwise sit in R2/Postgres forever with nothing pointing to it — this
 * is the one place that actually deletes it rather than just detaching it.
 *
 * Deliberately narrower than a generic "delete any media asset": refuses
 * (rather than silently no-op'ing) to delete anything that's still in use,
 * so this can never become a backdoor around the product gallery's own
 * detach flow or the Site Images grid's replace-only-never-delete model:
 *  - already attached to a product (has a `ProductImage` row) — use
 *    `DELETE /api/admin/products/[id]/images/[imageId]` instead, which
 *    intentionally *keeps* the `MediaAsset` row (see `removeProductImage`
 *    above) so a detached-but-still-uploaded photo can be re-attached
 *    elsewhere; this function is only for a photo nothing has ever used.
 *  - a manifest slot (`slot` is set) or a category's image — both are only
 *    ever replaced (re-upload/regenerate), never deleted, by design.
 */
/**
 * True when `assetId` is currently picked as a hero carousel slide's main
 * or secondary image (the "hero-slides" HomepageSection's JSON `content` —
 * see src/lib/homepage/index.ts's HeroSlideImage). That reference is a
 * snapshotted id/url/alt, not a real MediaAsset foreign key (see
 * heroSlideImageSchema's doc comment in src/lib/validation/schemas.ts), so
 * nothing in `asset._count` below would ever catch this on its own —
 * without this check, deleting the asset here would silently leave a live
 * slide pointing at a 404ing image.
 */
async function isReferencedByHeroSlide(assetId: string): Promise<boolean> {
  try {
    const section = await db.homepageSection.findUnique({ where: { key: "hero-slides" } });
    if (!section) return false;
    const content = JSON.parse(section.content) as { slides?: { image?: { assetId?: string } | null; secondaryImage?: { assetId?: string } | null }[] };
    return (content.slides ?? []).some(
      (slide) => slide.image?.assetId === assetId || slide.secondaryImage?.assetId === assetId,
    );
  } catch {
    // Malformed/missing content must never block an otherwise-legitimate
    // delete — same fail-open tradeoff readSectionContentFromDb makes.
    return false;
  }
}

export async function deleteUnattachedMediaAsset(
  id: string,
  storage: StorageDeps = defaultStorageDeps,
): Promise<void> {
  const asset = await db.mediaAsset.findUnique({
    where: { id },
    select: {
      id: true,
      key: true,
      slot: true,
      _count: { select: { productImages: true, categories: true } },
    },
  });
  if (!asset) throw new MediaAssetNotFoundError(id);
  if (asset.slot || asset._count.categories > 0) throw new MediaAssetInUseError();
  if (asset._count.productImages > 0) throw new MediaAssetAttachedError();
  if (await isReferencedByHeroSlide(asset.id)) throw new MediaAssetInUseError();

  if (storage.isConfigured() && storage.remove) {
    try {
      await storage.remove(asset.key);
    } catch {
      // Best-effort, mirroring the exact same tradeoff saveMediaAsset's own
      // slot-replacement cleanup makes above: a transient R2 failure must
      // not block removing the DB row, which is what makes this asset
      // visible/actionable at all. See scripts/cleanup-orphaned-media.ts
      // for the backstop that sweeps up anything this ever misses.
    }
  }

  await db.mediaAsset.delete({ where: { id: asset.id } });
}
