import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addStagedImage,
  addStagedImages,
  moveStagedImage,
  removeStagedImage,
  updateStagedImage,
  type StagedImage,
} from "./staged-images";

function img(mediaAssetId: string, overrides: Partial<StagedImage> = {}): StagedImage {
  return { mediaAssetId, url: `https://example.test/${mediaAssetId}.webp`, alt: "", color: null, ...overrides };
}

describe("addStagedImage / addStagedImages", () => {
  it("appends to the end without mutating the input array", () => {
    const list = [img("a")];
    const next = addStagedImage(list, img("b"));
    assert.deepEqual(list, [img("a")], "input array must not be mutated");
    assert.deepEqual(
      next.map((i) => i.mediaAssetId),
      ["a", "b"],
    );
  });

  it("appends multiple images (the AI-generate 'add selected candidates' case) preserving order", () => {
    const next = addStagedImages([img("a")], [img("b"), img("c")]);
    assert.deepEqual(
      next.map((i) => i.mediaAssetId),
      ["a", "b", "c"],
    );
  });
});

describe("removeStagedImage", () => {
  it("drops exactly the matching entry", () => {
    const list = [img("a"), img("b"), img("c")];
    const next = removeStagedImage(list, "b");
    assert.deepEqual(
      next.map((i) => i.mediaAssetId),
      ["a", "c"],
    );
  });

  it("is a no-op for an id that isn't present", () => {
    const list = [img("a")];
    const next = removeStagedImage(list, "nope");
    assert.deepEqual(next, list);
  });
});

describe("updateStagedImage", () => {
  it("patches only the matching entry's alt/color, leaving others untouched", () => {
    const list = [img("a", { color: "red" }), img("b")];
    const next = updateStagedImage(list, "a", { color: "blue", alt: "Front view" });
    assert.equal(next[0].color, "blue");
    assert.equal(next[0].alt, "Front view");
    assert.deepEqual(next[1], img("b"));
  });

  it("can clear color back to null", () => {
    const list = [img("a", { color: "red" })];
    const next = updateStagedImage(list, "a", { color: null });
    assert.equal(next[0].color, null);
  });
});

describe("moveStagedImage", () => {
  it("swaps with the previous sibling on 'up'", () => {
    const list = [img("a"), img("b"), img("c")];
    const next = moveStagedImage(list, "b", "up");
    assert.deepEqual(
      next.map((i) => i.mediaAssetId),
      ["b", "a", "c"],
    );
  });

  it("swaps with the next sibling on 'down'", () => {
    const list = [img("a"), img("b"), img("c")];
    const next = moveStagedImage(list, "b", "down");
    assert.deepEqual(
      next.map((i) => i.mediaAssetId),
      ["a", "c", "b"],
    );
  });

  it("is a no-op at the top edge", () => {
    const list = [img("a"), img("b")];
    const next = moveStagedImage(list, "a", "up");
    assert.deepEqual(
      next.map((i) => i.mediaAssetId),
      ["a", "b"],
    );
  });

  it("is a no-op at the bottom edge", () => {
    const list = [img("a"), img("b")];
    const next = moveStagedImage(list, "b", "down");
    assert.deepEqual(
      next.map((i) => i.mediaAssetId),
      ["a", "b"],
    );
  });

  it("is a no-op for an unknown id", () => {
    const list = [img("a"), img("b")];
    const next = moveStagedImage(list, "nope", "up");
    assert.deepEqual(next, list);
  });

  it("does not mutate the input array", () => {
    const list = [img("a"), img("b")];
    const snapshot = list.map((i) => ({ ...i }));
    moveStagedImage(list, "a", "down");
    assert.deepEqual(list, snapshot);
  });
});
