import sharp from "sharp";

/** Long edge cap for every processed image, matching the plan's storage budget. */
export const MAX_LONG_EDGE = 2400;
export const WEBP_QUALITY = 82;

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  contentType: "image/webp";
}

/**
 * F-064 fix: sharp throws its own low-level error (e.g. "Input buffer
 * contains unsupported image format") for a corrupt or unreadable upload —
 * a caller that lets that propagate as-is (a route's generic catch-all)
 * turns it into an opaque 500. Wrapping it here gives every caller
 * (admin media upload, review photo upload, AI generation's own decode of
 * whatever the model returned) one typed error to catch and map to a
 * clear 400, instead of each one re-deriving "was this a decode failure?"
 * from an untyped thrown value.
 */
export class InvalidImageError extends Error {
  constructor(cause?: unknown) {
    super("Couldn't read that file as an image — upload a JPEG, PNG, WebP, or AVIF.");
    this.name = "InvalidImageError";
    if (cause instanceof Error) this.cause = cause;
  }
}

/**
 * Normalizes any uploaded or AI-generated image before it goes to R2:
 * - `rotate()` with no arguments reads the EXIF `Orientation` tag, applies
 *   the corresponding rotation/flip, then removes the tag — so the output
 *   always displays right-side-up without carrying the tag forward.
 * - `sharp` does not include the rest of the source metadata (other EXIF
 *   fields, GPS, ICC profile aside from color correctness, XMP, IPTC) in
 *   its output unless `.withMetadata()` is called, which we deliberately
 *   never do — this strips it.
 * - Resized to a max 2400px long edge, never upscaled.
 * - Re-encoded as WebP at quality 82, a reasonable size/quality trade-off
 *   for both real photos and AI-generated images.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  try {
    const { data, info } = await sharp(input)
      .rotate()
      .resize({
        width: MAX_LONG_EDGE,
        height: MAX_LONG_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return {
      buffer: data,
      width: info.width,
      height: info.height,
      contentType: "image/webp",
    };
  } catch (error) {
    throw new InvalidImageError(error);
  }
}
