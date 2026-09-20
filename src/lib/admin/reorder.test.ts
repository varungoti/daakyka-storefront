import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { moveArrayItem, swapStepsForMove } from "@/lib/admin/reorder";

describe("swapStepsForMove", () => {
  it("returns no steps when the index doesn't change", () => {
    assert.deepEqual(swapStepsForMove(2, 2), []);
  });

  it("returns no steps for a negative index", () => {
    assert.deepEqual(swapStepsForMove(-1, 2), []);
    assert.deepEqual(swapStepsForMove(2, -1), []);
  });

  it("returns N 'up' steps when moving to an earlier index", () => {
    assert.deepEqual(swapStepsForMove(4, 1), ["up", "up", "up"]);
  });

  it("returns N 'down' steps when moving to a later index", () => {
    assert.deepEqual(swapStepsForMove(0, 3), ["down", "down", "down"]);
  });

  it("returns exactly one step for an adjacent move", () => {
    assert.deepEqual(swapStepsForMove(1, 2), ["down"]);
    assert.deepEqual(swapStepsForMove(2, 1), ["up"]);
  });

  it("applying the returned steps as adjacent swaps matches a direct splice move", () => {
    // This is the actual property the drag-and-drop UI depends on: walking
    // the swap-step sequence must land on the same final order as
    // splicing the item straight to its destination.
    for (const [from, to] of [[0, 4], [4, 0], [2, 2], [1, 3], [3, 1]] as const) {
      const list = ["a", "b", "c", "d", "e"];
      const steps = swapStepsForMove(from, to);
      const byAdjacentSwaps = list.slice();
      let cursor: number = from;
      for (const direction of steps) {
        const swapWith = direction === "up" ? cursor - 1 : cursor + 1;
        [byAdjacentSwaps[cursor], byAdjacentSwaps[swapWith]] = [byAdjacentSwaps[swapWith], byAdjacentSwaps[cursor]];
        cursor = swapWith;
      }
      assert.deepEqual(byAdjacentSwaps, moveArrayItem(list, from, to), `mismatch for move ${from}->${to}`);
    }
  });
});

describe("moveArrayItem", () => {
  it("moves an item earlier in the list", () => {
    assert.deepEqual(moveArrayItem(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  });

  it("moves an item later in the list", () => {
    assert.deepEqual(moveArrayItem(["a", "b", "c", "d"], 0, 3), ["b", "c", "d", "a"]);
  });

  it("is a no-op for an unchanged index", () => {
    const list = ["a", "b", "c"];
    assert.equal(moveArrayItem(list, 1, 1), list);
  });

  it("is a no-op (returns the same reference) for an out-of-range index", () => {
    const list = ["a", "b", "c"];
    assert.equal(moveArrayItem(list, 0, 5), list);
    assert.equal(moveArrayItem(list, -1, 1), list);
  });

  it("never mutates the input array", () => {
    const list = ["a", "b", "c"];
    const snapshot = [...list];
    moveArrayItem(list, 0, 2);
    assert.deepEqual(list, snapshot);
  });
});
