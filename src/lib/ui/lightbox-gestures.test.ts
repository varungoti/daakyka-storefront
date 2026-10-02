import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampTranslate, panBy } from "@/lib/ui/lightbox-gestures";

/**
 * F-114: the lightbox's double-tap / pinch zoom to 2-3x could not be panned —
 * only the two-finger pinch was handled — so the rest of a zoomed photo was out
 * of reach. A one-finger drag now moves it; this is the arithmetic behind that.
 */
describe("lightbox pan", () => {
  const W = 400;
  const H = 600;

  it("moves the picture by the finger's distance on screen: a drag of d is d / scale in the picture's own pixels", () => {
    const next = panBy({ x: 0, y: 0 }, -40, 0, 2, W, H);
    // transform: scale(2) translate(-20px, 0) shifts it 40px on screen.
    assert.deepEqual(next, { x: -20, y: 0 });
    assert.equal(next.x * 2, -40);
  });

  it("accumulates over several moves", () => {
    let translate = { x: 0, y: 0 };
    translate = panBy(translate, -10, 6, 2, W, H);
    translate = panBy(translate, -10, 6, 2, W, H);
    assert.deepEqual(translate, { x: -10, y: 6 });
  });

  it("stops at the edge of the zoomed picture instead of dragging it off screen", () => {
    // At 2x the picture overhangs its box by half its size: 100px each side in
    // the picture's pixels for a 400px-wide box (400 * (2 - 1) / (2 * 2)).
    const far = panBy({ x: 0, y: 0 }, -5000, 5000, 2, W, H);
    assert.deepEqual(far, { x: -100, y: 150 });
  });

  it("allows more travel at a higher zoom", () => {
    const at2 = panBy({ x: 0, y: 0 }, 5000, 0, 2, W, H).x;
    const at3 = panBy({ x: 0, y: 0 }, 5000, 0, 3, W, H).x;
    assert.ok(at3 > at2);
  });

  it("does not pan an unzoomed picture", () => {
    assert.deepEqual(panBy({ x: 0, y: 0 }, 50, 50, 1, W, H), { x: 0, y: 0 });
    assert.deepEqual(panBy({ x: 30, y: 30 }, 50, 50, 1, W, H), { x: 0, y: 0 });
  });

  it("pulls the picture back inside its limits when zooming out shrinks them", () => {
    const zoomedFar = { x: -150, y: 220 };
    assert.deepEqual(clampTranslate(zoomedFar, 3, W, H), { x: -133.33333333333334, y: 200 });
    assert.deepEqual(clampTranslate(zoomedFar, 1, W, H), { x: 0, y: 0 });
  });

  it("leaves an in-range translate alone", () => {
    assert.deepEqual(clampTranslate({ x: 10, y: -10 }, 2, W, H), { x: 10, y: -10 });
  });
});
