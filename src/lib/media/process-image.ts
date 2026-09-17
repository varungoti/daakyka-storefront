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
}
