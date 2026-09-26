import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeTargetDimensions, shouldSkipClientCompression } from "@/lib/media/prepare-upload";

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
