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
}

export const defaultStorageDeps: StorageDeps = {
  isConfigured: isR2Configured,
  upload: uploadObject,
  publicUrl: publicUrlForKey,
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
