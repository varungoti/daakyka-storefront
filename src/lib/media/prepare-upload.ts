/**
 * F-178 fix: browser-side downscale/re-encode for an admin image upload,
 * run before the file ever leaves the browser.
 *
 * Vercel's platform limit for a Function's request body is 4.5MB
 * (vercel.com/docs/functions/limitations) — well under the 10MB
 * `MAX_UPLOAD_BYTES` this app's own upload route used to allow (now
 * lowered to match, see src/app/api/admin/media/route.ts). A 12-50MP phone
 * JPEG is very often 4.5-12MB, so without this, an ordinary phone photo —
 * the owner manages the admin from a phone — passed every check this app
 * has and then got rejected by the platform itself before the route ever
 * ran, with no useful error surfaced anywhere.
 *
 * The server already downsizes every image to a `MAX_LONG_EDGE` of 2400px
 * and re-encodes to WebP (src/lib/media/process-image.ts), so shrinking to
 * the same dimensions here on the way in throws away nothing that would
 * have survived the round trip anyway. This module can't import
 * process-image.ts directly — it pulls in `sharp`, a Node-only native
 * module that would break the client bundle — so the matching constants
 * are duplicated below and must be kept in sync by hand.
 *
 * Every failure path here (unsupported browser, undecodable file, encode
 * failure) falls back to returning the original `File` unchanged, so a
 * caller can always just upload whatever this returns — the server's own
 * size/type checks and InvalidImageError (F-187) remain the real
 * enforcement either way, this is purely a best-effort head start.
 */

/** Mirrors MAX_LONG_EDGE in src/lib/media/process-image.ts. */
const LONG_EDGE = 2400;
/** Mirrors WEBP_QUALITY (82/100) in src/lib/media/process-image.ts as a
 * 0-1 fraction, used as the first re-encode attempt. */
const INITIAL_QUALITY = 0.82;
/** Progressively smaller re-encodes if the first attempt is still over
 * CLIENT_TARGET_BYTES below. */
const QUALITY_STEPS = [INITIAL_QUALITY, 0.72, 0.6];
/** Leaves headroom under the server's own 4MB MAX_UPLOAD_BYTES for
 * multipart/form-data overhead (boundaries, headers, the other fields). */
const CLIENT_TARGET_BYTES = 3.8 * 1024 * 1024;
/** Files at or under this size are left completely alone — re-encoding an
 * already-small file only risks quality loss (or losing PNG transparency)
 * for no size benefit. */
const SKIP_COMPRESSION_MAX_BYTES = 3.5 * 1024 * 1024;

const SKIPPABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

/** Output formats to try, best first. WebP matches what the server stores;
 * JPEG is the fallback for a browser that can't encode WebP (see
 * encodeWithinBudget). */
const ENCODE_TYPES = ["image/webp", "image/jpeg"] as const;

/** Pure decision of whether a file needs client-side compression at all —
 * exported so this (unlike the actual canvas/bitmap work below, which
 * needs a browser) is unit-testable without a DOM. */
export function shouldSkipClientCompression(file: { size: number; type: string }): boolean {
  return file.size <= SKIP_COMPRESSION_MAX_BYTES && SKIPPABLE_TYPES.has(file.type);
}

/** Pure "fit inside a square of `longEdge`, never upscale" resize
 * calculation — same rule as sharp's `resize({ fit: "inside",
 * withoutEnlargement: true })` in process-image.ts. Exported for the same
 * reason as shouldSkipClientCompression. */
export function computeTargetDimensions(
  width: number,
  height: number,
  longEdge: number = LONG_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= longEdge || longest <= 0) return { width, height };
  const scale = longEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Asks the browser to encode the current image as `type` at `quality`
 * (0-1), resolving to null when it can't produce a blob at all. */
export type BlobEncoder = (type: string, quality: number) => Promise<Blob | null>;

/**
 * Picks the first (best) format/quality combination that fits
 * `maxBytes`, stepping quality down within a format before moving to the
 * next one. Returns the smallest blob that did encode when nothing fits
 * (the caller decides whether that still beats the original), or null
 * when the browser couldn't encode anything.
 *
 * Pure in the sense that matters — the actual canvas is behind `encode` —
 * so it's unit-testable with a fake encoder. The check that matters most
 * is `blob.type !== type`: `canvas.toBlob` does NOT fail for a format the
 * browser can't encode, it silently hands back a PNG instead (Safari/iOS
 * has no WebP encoder). A lossless 2400px PNG photo is routinely 5-9MB —
 * worse than the original — and a quality parameter does nothing for PNG,
 * so treating that as "WebP worked" would defeat the whole point on
 * exactly the phones this exists for. Such a type is skipped instead.
 */
export async function encodeWithinBudget(
  encode: BlobEncoder,
  maxBytes: number = CLIENT_TARGET_BYTES,
): Promise<{ blob: Blob; type: string } | null> {
  let smallest: { blob: Blob; type: string } | null = null;
  for (const type of ENCODE_TYPES) {
    for (const quality of QUALITY_STEPS) {
      const blob = await encode(type, quality);
      if (!blob || blob.size === 0 || blob.type !== type) break; // this format isn't encodable here
      if (blob.size <= maxBytes) return { blob, type };
      if (!smallest || blob.size < smallest.blob.size) smallest = { blob, type };
    }
  }
  return smallest;
}

function canEncodeToBlob(): boolean {
  return typeof document !== "undefined" && typeof HTMLCanvasElement !== "undefined";
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function withExtension(name: string, type: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base || "image"}.${type === "image/jpeg" ? "jpg" : "webp"}`;
}

/**
 * Downscales/re-encodes `file` in the browser when it's large enough to be
 * worth it, resolving to the original `file` unchanged whenever that isn't
 * possible (see the file doc comment above for why that's always a safe
 * fallback).
 *
 * Decodes with `createImageBitmap(file, { imageOrientation: "from-image"
 * })` so EXIF rotation (very common on phone photos) is applied before the
 * canvas draw — a canvas has no EXIF of its own, so this is the only point
 * orientation can be preserved.
 */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (shouldSkipClientCompression(file)) return file;
  if (typeof createImageBitmap !== "function" || !canEncodeToBlob()) return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Can't decode client-side (e.g. an AVIF the browser itself can't
    // decode, or a corrupt file) — upload the original and let the
    // server's own InvalidImageError/400 (F-187) be the real check.
    return file;
  }

  try {
    const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    let flattened = false;
    const result = await encodeWithinBudget(async (type, quality) => {
      if (type === "image/jpeg" && !flattened) {
        // JPEG has no alpha channel — transparent pixels would come out
        // black. Paint white *behind* what's already drawn, once.
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = "source-over";
        flattened = true;
      }
      return canvasToBlob(canvas, type, quality);
    });
    // Nothing encodable, or the best attempt is no smaller than what we
    // already have: leave the original alone.
    if (!result || result.blob.size >= file.size) return file;
    return new File([result.blob], withExtension(file.name, result.type), { type: result.type });
  } finally {
    bitmap.close();
  }
}
