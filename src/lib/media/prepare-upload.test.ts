import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTargetDimensions, encodeWithinBudget, shouldSkipClientCompression } from "@/lib/media/prepare-upload";

// F-178: the actual browser-dependent encode path (createImageBitmap,
// canvas) needs a real DOM this repo's Node-test-runner unit tests don't
// have — see prepare-upload.ts's own doc comment. These two decision
// functions are deliberately kept pure/DOM-free so the logic that matters
// (when to compress, and to what size) is still exercised directly.

describe("shouldSkipClientCompression", () => {
  it("skips a small, already-allowed file", () => {
    assert.equal(shouldSkipClientCompression({ size: 1 * 1024 * 1024, type: "image/jpeg" }), true);
  });

  it("does not skip a large file", () => {
    assert.equal(shouldSkipClientCompression({ size: 6 * 1024 * 1024, type: "image/jpeg" }), false);
  });

  it("does not skip a type it can't encode from (e.g. image/gif)", () => {
    assert.equal(shouldSkipClientCompression({ size: 1024, type: "image/gif" }), false);
  });
});

describe("computeTargetDimensions", () => {
  it("leaves a small image untouched", () => {
    assert.deepEqual(computeTargetDimensions(800, 600), { width: 800, height: 600 });
  });

  it("scales a wide image down to the long edge", () => {
    const result = computeTargetDimensions(6000, 4000, 2400);
    assert.equal(result.width, 2400);
    assert.equal(result.height, 1600);
  });

  it("scales a tall image down to the long edge", () => {
    const result = computeTargetDimensions(3000, 6000, 2400);
    assert.equal(result.height, 2400);
    assert.equal(result.width, 1200);
  });

  it("never upscales", () => {
    assert.deepEqual(computeTargetDimensions(500, 400, 2400), { width: 500, height: 400 });
  });
});

// F-178: canvas.toBlob never fails for a format the browser can't encode —
// it silently returns a PNG. These use a fake encoder (the real one needs a
// browser canvas) to prove encodeWithinBudget doesn't mistake that PNG for
// the WebP it asked for, which would re-introduce the oversize upload on
// exactly the browsers (Safari/iOS) a phone-photo owner uses.
describe("encodeWithinBudget", () => {
  const MB = 1024 * 1024;
  const blobOf = (type: string, bytes: number) => new Blob([new Uint8Array(bytes)], { type });

  it("returns the first WebP attempt when it already fits", async () => {
    const calls: string[] = [];
    const result = await encodeWithinBudget(async (type, quality) => {
      calls.push(`${type}@${quality}`);
      return blobOf(type, 1 * MB);
    });
    assert.equal(result?.type, "image/webp");
    assert.deepEqual(calls, ["image/webp@0.82"]);
  });

  it("steps quality down within WebP until the result fits", async () => {
    const sizes: Record<string, number> = { "0.82": 6 * MB, "0.72": 5 * MB, "0.6": 2 * MB };
    const result = await encodeWithinBudget(async (type, quality) => blobOf(type, sizes[String(quality)]));
    assert.equal(result?.type, "image/webp");
    assert.equal(result?.blob.size, 2 * MB);
  });

  it("falls back to JPEG when the browser silently returns a PNG for a WebP request", async () => {
    const calls: string[] = [];
    const result = await encodeWithinBudget(async (type, quality) => {
      calls.push(`${type}@${quality}`);
      // Safari: no WebP encoder, so toBlob hands back a (huge, lossless) PNG.
      return type === "image/webp" ? blobOf("image/png", 9 * MB) : blobOf("image/jpeg", 2 * MB);
    });
    assert.equal(result?.type, "image/jpeg");
    assert.equal(result?.blob.size, 2 * MB);
    // The PNG is detected on the first attempt — no pointless quality steps.
    assert.deepEqual(calls, ["image/webp@0.82", "image/jpeg@0.82"]);
  });

  it("returns the smallest blob when nothing fits the budget, so the caller can still compare it to the original", async () => {
    const sizes: Record<string, number> = { "0.82": 9 * MB, "0.72": 7 * MB, "0.6": 6 * MB };
    const result = await encodeWithinBudget(async (type, quality) => blobOf(type, sizes[String(quality)]));
    assert.equal(result?.blob.size, 6 * MB);
  });

  it("returns null when the browser can't encode anything", async () => {
    assert.equal(await encodeWithinBudget(async () => null), null);
    assert.equal(await encodeWithinBudget(async (type) => blobOf(type, 0)), null);
  });
});
