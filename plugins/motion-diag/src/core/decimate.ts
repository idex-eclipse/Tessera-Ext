/**
 * Thinning of long series for drawing.
 *
 * A capture at 0.1 ms steps has hundreds of thousands of points, far more than a chart has
 * pixels. Dropping points would hide spikes (exactly what a diagnostic graph is for), so
 * each bucket of consecutive samples keeps its minimum and its maximum.
 *
 * uPlot wants one x array for all series, so every series is cut at the same sample
 * indices and a bucket contributes two x positions (its start and its middle); each
 * series puts its min and max there in the order they occurred.
 */

export interface Thinned {
  x: Float64Array;
  /** One array per input series, aligned with `x`. */
  y: Float64Array[];
}

/** First index in sorted `x` whose value is >= `value`. */
export function lowerBound(x: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = x.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The samples with `from <= x <= to`, thinned to at most about `maxPoints` per series.
 * Short ranges are returned as they are (copied, so callers own the result).
 */
export function thinRange(
  x: Float64Array,
  series: readonly Float64Array[],
  from: number,
  to: number,
  maxPoints: number,
): Thinned {
  const i0 = Math.max(0, lowerBound(x, from) - 1);
  const i1 = Math.min(x.length, lowerBound(x, to) + 1);
  const n = i1 - i0;
  if (n <= maxPoints) {
    return { x: x.slice(i0, i1), y: series.map((s) => s.slice(i0, i1)) };
  }

  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const size = n / buckets;
  const outX = new Float64Array(buckets * 2);
  const outY = series.map(() => new Float64Array(buckets * 2));
  for (let b = 0; b < buckets; b++) {
    const start = i0 + Math.floor(b * size);
    const end = Math.min(i1, i0 + Math.floor((b + 1) * size));
    const last = Math.max(start, end - 1);
    outX[2 * b] = x[start]!;
    outX[2 * b + 1] = x[start + ((last - start) >> 1)]!;
    series.forEach((s, k) => {
      let min = Infinity;
      let max = -Infinity;
      let iMin = start;
      let iMax = start;
      for (let i = start; i <= last; i++) {
        const v = s[i]!;
        // NaN is a gap: keep it so that the line breaks there instead of bridging it.
        if (Number.isNaN(v)) continue;
        if (v < min) {
          min = v;
          iMin = i;
        }
        if (v > max) {
          max = v;
          iMax = i;
        }
      }
      const ys = outY[k]!;
      if (min === Infinity) {
        ys[2 * b] = Number.NaN;
        ys[2 * b + 1] = Number.NaN;
      } else if (iMin <= iMax) {
        ys[2 * b] = min;
        ys[2 * b + 1] = max;
      } else {
        ys[2 * b] = max;
        ys[2 * b + 1] = min;
      }
    });
  }
  return { x: outX, y: outY };
}
