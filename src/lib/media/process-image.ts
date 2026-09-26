import sharp from "sharp";

/** Long edge cap for every processed image, matching the plan's storage budget. */
export const MAX_LONG_EDGE = 2400;
export const WEBP_QUALITY = 82;

/**
 * F-359 fix: sharp's own default `limitInputPixels` (0x3FFF * 0x3FFF ≈
 * 268 megapixels) is a decode-time safety valve, but it's sized for "don't
 * let libvips allocate literally unbounded memory" — not for "this is a
 * reasonable photo". A single-colour (and so highly compressible) PNG under
 * 1 MB can still declare 16000x16000 (256 MP) in its header, which is under
 * sharp's default cap and so decodes successfully, allocating ~190 MB of
 * pixel buffer per request; a handful of concurrent uploads from one
 * customer can push a Vercel function toward its memory limit. 50 MP is
 * generous for any real camera/phone photo (a 12 MP phone photo is
 * 4000x3000) while keeping worst-case decode memory in the tens of MB.
 * Passed to `sharp()` itself so the check runs against the file's declared
 * header dimensions, before any pixel data is decoded — not a `.metadata()`
 * pre-check followed by a second `sharp()` call, which would decode the
 * header twice for no benefit.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

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
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
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
