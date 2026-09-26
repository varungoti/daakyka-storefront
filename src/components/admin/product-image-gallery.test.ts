import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  attachPicksSequentially,
  type AttachImagePick,
  type ProductImageRow,
} from "@/components/admin/product-image-gallery";

// F-358: attachPicksSequentially is the pure orchestration this repo's
// unit tests run under Node's test runner with no jsdom, so this exercises
// it directly rather than the React component — same pattern as
// product-variant-editor.test.ts.

function row(id: string): ProductImageRow {
  return { id, mediaId: `media-${id}`, url: `https://example.test/${id}.webp`, alt: null, color: null, sortOrder: 0 };
}

describe("attachPicksSequentially (F-358)", () => {
  it("folds two rapid picks into one final list — not just the last one", async () => {
    // Simulates two files finishing upload in the same batch: each
    // postAttach call resolves a *different* row, and both must end up in
    // the returned `current`, not just whichever resolved last (the
    // stale-closure bug this replaces would have dropped the first).
    const picks: AttachImagePick[] = [
      { id: "asset-1", alt: "First" },
      { id: "asset-2", alt: "Second" },
    ];

    const { current, failureCount } = await attachPicksSequentially([], [row("existing")], async () => null);
    assert.deepEqual(current, [row("existing")]);
    assert.equal(failureCount, 0);

    const result = await attachPicksSequentially(picks, [], async (pick) => row(pick.id));
    assert.equal(result.failureCount, 0);
    assert.deepEqual(
      result.current.map((r) => r.id),
      ["asset-1", "asset-2"],
    );
  });

  it("starts from the given `current`, not an empty list", async () => {
    const result = await attachPicksSequentially(
      [{ id: "asset-2", alt: "Second" }],
      [row("asset-1")],
      async (pick) => row(pick.id),
    );
    assert.deepEqual(
      result.current.map((r) => r.id),
      ["asset-1", "asset-2"],
    );
  });

  it("skips a failed pick (postAttach resolves null) without losing the others", async () => {
    const picks: AttachImagePick[] = [
      { id: "ok-1", alt: "" },
      { id: "bad", alt: "" },
      { id: "ok-2", alt: "" },
    ];
    const result = await attachPicksSequentially(picks, [], async (pick) =>
      pick.id === "bad" ? null : row(pick.id),
    );
    assert.equal(result.failureCount, 1);
    assert.deepEqual(
      result.current.map((r) => r.id),
      ["ok-1", "ok-2"],
    );
  });

  it("leaves `current` untouched when every pick fails", async () => {
    const result = await attachPicksSequentially([{ id: "bad", alt: "" }], [row("existing")], async () => null);
    assert.equal(result.failureCount, 1);
    assert.deepEqual(result.current, [row("existing")]);
  });
});
