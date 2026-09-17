import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { MediaAsset, MediaSource, MediaUsage } from "@/generated/prisma/client";
import { processImage } from "@/lib/media/process-image";
import {
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

  const processed = await processImage(input.buffer);
  const key = objectKeyFor(input.usage);

  await storage.upload(key, processed.buffer, processed.contentType);
  const url = storage.publicUrl(key);

  return db.mediaAsset.create({
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
}
