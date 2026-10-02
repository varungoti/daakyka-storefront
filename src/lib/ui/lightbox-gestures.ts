/**
 * F-114: the pan arithmetic for the full-screen image viewer, pulled out of
 * ImageLightbox so it can be tested without a browser.
 *
 * The viewer draws the picture with `transform: scale(s) translate(x, y)`, so
 * `translate` is in the picture's own (unscaled) pixels and moves it on screen
 * by `s` times as much. A finger drag of `d` screen pixels therefore changes
 * the translate by `d / s`. The picture is centred in a `width` x `height`
 * box; zoomed to `s` it overhangs that box by `(s - 1) / 2` of its size on every
 * side, which is as far as it can be dragged before the edge of the picture
 * would come into view.
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Elements inside the viewer that handle a press themselves: the previous and
 * next arrows (and, defensively, any link or form control added later).
 */
export const POINTER_CONTROL_SELECTOR = "button, a, input, select, textarea, [role='button']";

/**
 * Whether a pointer press began on one of the viewer's own controls.
 *
 * The viewer captures the pointer on its container so a drag can never be left
 * half-finished. A captured pointer is released to the container, and the click
 * that follows is delivered to the container too: a press on an arrow button
 * that was captured never reaches the button's onClick, so the arrows would
 * silently stop working for mouse and touch. A press that begins on a control is
 * therefore neither tracked nor captured.
 */
export function startsOnControl(target: { closest(selector: string): unknown } | null): boolean {
  return target !== null && target.closest(POINTER_CONTROL_SELECTOR) !== null;
}

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

/** Keeps a translate inside what the zoomed picture can actually be dragged
 * to. At scale 1 (or below) nothing can be dragged, so it is the origin. */
export function clampTranslate(translate: Point, scale: number, width: number, height: number): Point {
  if (scale <= 1) return { x: 0, y: 0 };
  const maxX = (width * (scale - 1)) / (2 * scale);
  const maxY = (height * (scale - 1)) / (2 * scale);
  return { x: clamp(translate.x, maxX), y: clamp(translate.y, maxY) };
}

/** The translate after dragging the picture by (`dxPx`, `dyPx`) screen pixels. */
export function panBy(
  translate: Point,
  dxPx: number,
  dyPx: number,
  scale: number,
  width: number,
  height: number,
): Point {
  if (scale <= 1) return { x: 0, y: 0 };
  return clampTranslate({ x: translate.x + dxPx / scale, y: translate.y + dyPx / scale }, scale, width, height);
}
