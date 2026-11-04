/**
 * Zooming the time axis around a point, for Shift + mouse wheel.
 */

/** How strongly one wheel notch (100 units of delta) changes the visible span: about 28%. */
const SPAN_PER_NOTCH = 0.25;

/** Largest delta taken from one event, so a fast trackpad flick cannot jump across the data. */
const MAX_DELTA = 300;

export interface Range {
  min: number;
  max: number;
}

/**
 * The wheel's vertical movement in pixels, whatever the unit the browser reports it in.
 * Browsers turn Shift + wheel into horizontal scrolling, so the larger of the two axes is used.
 */
export function wheelDelta(e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>): number {
  const raw = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  // deltaMode: 0 pixels, 1 lines, 2 pages
  return raw * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
}

/**
 * The new visible range after a wheel movement of `delta` (negative = wheel up = zoom in).
 *
 * The value under the cursor (`focus`) stays where it is on the screen: the range grows or
 * shrinks around it in proportion to its distance from each edge. The result never leaves
 * `bounds` (all the data) and is never narrower than `minSpan`. Zooming out at the full
 * range returns the same range.
 */
export function zoomAround(view: Range, focus: number, delta: number, bounds: Range, minSpan: number): Range {
  const factor = Math.exp((Math.max(-MAX_DELTA, Math.min(MAX_DELTA, delta)) / 100) * SPAN_PER_NOTCH);
  const full = bounds.max - bounds.min;
  const span = Math.min(full, Math.max(Math.min(minSpan, full), (view.max - view.min) * factor));
  // Keep the focus at the same relative position inside the window.
  const at = view.max > view.min ? (focus - view.min) / (view.max - view.min) : 0.5;
  let min = focus - at * span;
  let max = min + span;
  // Slide back inside the data instead of cutting the span short at an edge.
  if (min < bounds.min) {
    min = bounds.min;
    max = min + span;
  }
  if (max > bounds.max) {
    max = bounds.max;
    min = max - span;
  }
  return { min, max };
}
