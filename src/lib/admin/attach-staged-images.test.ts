import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attachStagedImages, type AttachStagedImagesDeps } from "./attach-staged-images";
import type { StagedImage } from "./staged-images";
import type { ProductImageRow } from "@/components/admin/product-image-gallery";

function staged(mediaAssetId: string, overrides: Partial<StagedImage> = {}): StagedImage {
  return { mediaAssetId, url: `https://example.test/${mediaAssetId}.webp`, alt: "", color: null, ...overrides };
}

function attachedRow(staged: StagedImage, sortOrder: number): ProductImageRow {
  return { id: `image-${staged.mediaAssetId}`, mediaId: staged.mediaAssetId, url: staged.url, alt: staged.alt || null, color: staged.color, sortOrder };
}

describe("attachStagedImages (F-04 single-pass create — docs/audit-2026-09-19/admin-ux.md)", () => {
  it("attaches nothing and calls the dependency zero times for an empty staged list", async () => {
    let calls = 0;
    const deps: AttachStagedImagesDeps = { attach: async () => { calls += 1; return null; } };

    const result = await attachStagedImages("product-1", [], deps);

    assert.deepEqual(result, { attached: [], failed: [] });
    assert.equal(calls, 0);
  });

  it("attaches every staged image, in order, when every call succeeds", async () => {
    const images = [staged("m1"), staged("m2"), staged("m3")];
    const calledWith: string[] = [];
    const deps: AttachStagedImagesDeps = {
      attach: async (productId, image) => {
        calledWith.push(image.mediaAssetId);
        return attachedRow(image, calledWith.length - 1);
      },
    };

    const result = await attachStagedImages("product-1", images, deps);

    assert.deepEqual(calledWith, ["m1", "m2", "m3"], "must call attach for each staged image, in staged order");
    assert.equal(result.failed.length, 0);
    assert.deepEqual(
      result.attached.map((row) => row.mediaId),
      ["m1", "m2", "m3"],
    );
    assert.deepEqual(
      result.attached.map((row) => row.sortOrder),
      [0, 1, 2],
      "sortOrder should follow the staged order the calls were made in",
    );
  });

  it("passes the productId and the staged image's color/alt through to attach", async () => {
    const images = [staged("m1", { color: "Navy", alt: "Front view" })];
    let seenProductId: string | undefined;
    let seenImage: StagedImage | undefined;
    const deps: AttachStagedImagesDeps = {
      attach: async (productId, image) => {
        seenProductId = productId;
        seenImage = image;
        return attachedRow(image, 0);
      },
    };

    await attachStagedImages("product-42", images, deps);

    assert.equal(seenProductId, "product-42");
    assert.equal(seenImage?.color, "Navy");
    assert.equal(seenImage?.alt, "Front view");
  });

  it("tolerates an individual attach failure — the rest of the batch still attaches, and the product save is never blocked by it", async () => {
    const images = [staged("m1"), staged("m2"), staged("m3")];
    const deps: AttachStagedImagesDeps = {
      attach: async (_productId, image) => (image.mediaAssetId === "m2" ? null : attachedRow(image, 0)),
    };

    const result = await attachStagedImages("product-1", images, deps);

    assert.deepEqual(
      result.attached.map((row) => row.mediaId),
      ["m1", "m3"],
    );
    assert.deepEqual(
      result.failed.map((img) => img.mediaAssetId),
      ["m2"],
      "the failed staged image is preserved (not silently dropped) so the caller can decide what to do with it",
    );
  });

  it("reports every image as failed when the dependency always fails, without throwing", async () => {
    const images = [staged("m1"), staged("m2")];
    const deps: AttachStagedImagesDeps = { attach: async () => null };

    const result = await attachStagedImages("product-1", images, deps);

    assert.equal(result.attached.length, 0);
    assert.deepEqual(
      result.failed.map((img) => img.mediaAssetId),
      ["m1", "m2"],
    );
  });
});
