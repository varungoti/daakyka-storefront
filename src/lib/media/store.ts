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
 * The `hero-slides` HomepageSection's JSON `content` — see
 * src/lib/homepage/index.ts's `HeroSlideImage` — snapshots an `assetId`
 * rather than holding a real `MediaAsset` foreign key (see
 * `heroSlideImageSchema`'s doc comment in src/lib/validation/schemas.ts).
 * Shared shape for both `isReferencedByHeroSlide` and `getHeroSlideAssetIds`
 * below.
 */
interface HeroSlidesContent {
  slides?: { image?: { assetId?: string } | null; secondaryImage?: { assetId?: string } | null }[];
}

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
    super("Cloudflare R2 storage is not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET (or supported CLOUDFLARE_* aliases)");
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
 *
 * F-064/F-356/F-361 fix: a slot "replace" used to delete the previously
 * slotted asset's R2 object and DB row *before* the new file had even been
 * decoded — a corrupt/unsupported upload, or a transient storage failure,
 * left the slot (and every ProductImage/Category/hero-slide that reused
 * that asset from the Media Library — F-356) permanently empty, and even a
 * *successful* replace had a window where the old object was already gone
 * but the new one wasn't live yet (F-361). Now the risky work (decode +
 * upload the new object) happens first, so a failure never touches
 * anything that already exists; the DB swap only ever *frees* the old
 * row's `slot` (never deletes the row or its R2 object), so every existing
 * reference to it survives untouched. The freed-up row is left for
 * `deleteUnattachedMediaAsset`/`cleanup-orphaned-media.ts` to reclaim once
 * nothing references it any more — see those for the guards that make that
 * safe.
 */
export async function saveMediaAsset(
  input: SaveMediaAssetInput,
  storage: StorageDeps = defaultStorageDeps,
): Promise<MediaAsset> {
  if (!storage.isConfigured()) {
    throw new StorageNotConfiguredForMediaError();
  }

  // Decode/process and upload the *new* image first. Nothing existing is
  // touched yet, so a bad file (processImage/sharp throws) or a storage
  // failure here leaves whatever previously held this slot completely
  // untouched.
  const processed = await processImage(input.buffer);
  const key = objectKeyFor(input.usage);
  await storage.upload(key, processed.buffer, processed.contentType);
  const url = storage.publicUrl(key);

  let asset: MediaAsset;
  try {
    asset = await db.$transaction(async (tx) => {
      // `MediaAsset.slot` is @unique — a slotted asset (manifest site
      // images, Phase E2) can be "replaced" (re-uploaded or regenerated)
      // any number of times. Free the slot on whatever row currently holds
      // it (rather than deleting that row) before creating the new one, so
      // the unique constraint never trips *and* the old row's own
      // references — ProductImage rows, a Category.imageId, a hero-slide
      // snapshot picked via the Media Library (F-356) — stay intact.
      if (input.slot) {
        const existing = await tx.mediaAsset.findUnique({ where: { slot: input.slot } });
        if (existing) {
          await tx.mediaAsset.update({ where: { id: existing.id }, data: { slot: null } });
        }
      }

      return tx.mediaAsset.create({
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
    });
  } catch (error) {
    // The DB step failed after the new object was already uploaded — it
    // has no row pointing at it, so remove it, best-effort, rather than
    // leaving a silent orphan, then re-throw the original error.
    try {
      await storage.remove?.(key);
    } catch {
      // Best-effort only — see the cleanup script for the backstop.
    }
    throw error;
  }

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
    super("This image is still in use (a site image, a category, a hero slide, or a customer review photo) and can't be deleted here.");
    this.name = "MediaAssetInUseError";
  }
}

/**
 * Every `MediaAsset` id currently picked as a hero carousel slide's main or
 * secondary image (the "hero-slides" HomepageSection's JSON `content` —
 * see src/lib/homepage/index.ts's HeroSlideImage). That reference is a
 * snapshotted id/url/alt, not a real MediaAsset foreign key (see
 * heroSlideImageSchema's doc comment in src/lib/validation/schemas.ts), so
 * nothing in `asset._count` below (or in a plain MediaAsset query) would
 * ever catch this on its own. Fetches the section once so a caller that
 * needs to check several assets (F-064: the media library's `usageInfo`)
 * doesn't re-parse the same JSON per asset.
 */
export async function getHeroSlideAssetIds(): Promise<Set<string>> {
  try {
    const section = await db.homepageSection.findUnique({ where: { key: "hero-slides" } });
    if (!section) return new Set();
    const content = JSON.parse(section.content) as HeroSlidesContent;
    const ids = new Set<string>();
    for (const slide of content.slides ?? []) {
      if (slide.image?.assetId) ids.add(slide.image.assetId);
      if (slide.secondaryImage?.assetId) ids.add(slide.secondaryImage.assetId);
    }
    return ids;
  } catch {
    // Malformed/missing content must never block an otherwise-legitimate
    // delete — same fail-open tradeoff readSectionContentFromDb makes.
    return new Set();
  }
}

/** True when `assetId` is currently picked as a hero carousel slide's
 * image — without this check, deleting/orphan-sweeping the asset would
 * silently leave a live slide pointing at a 404ing image. */
async function isReferencedByHeroSlide(assetId: string): Promise<boolean> {
  return (await getHeroSlideAssetIds()).has(assetId);
}

/**
 * True when `assetId` appears in the `photoIds` of any review that isn't
 * REJECTED (F-357). `Review.photoIds` is a plain `String[]`, not a real FK
 * (see prisma/schema.prisma), so — same as the hero-slide snapshot above —
 * nothing in `asset._count` would ever catch this: without this check, an
 * approved review's photos would be indistinguishable from a genuinely
 * unattached upload once their 48h grace period passed.
 */
async function isReferencedByNonRejectedReview(assetId: string): Promise<boolean> {
  const review = await db.review.findFirst({
    where: { photoIds: { has: assetId }, status: { not: "REJECTED" } },
    select: { id: true },
  });
  return review !== null;
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
 *  - a manifest slot is now freed rather than deleted by `saveMediaAsset`
 *    itself (F-064/F-356), and a review photo (F-357) — both are only ever
 *    reclaimed here, once nothing references them any more, never deleted
 *    up front.
 */
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
  if (await isReferencedByNonRejectedReview(asset.id)) throw new MediaAssetInUseError();

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
