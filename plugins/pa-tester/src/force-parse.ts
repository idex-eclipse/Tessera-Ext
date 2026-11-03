/**
 * Batches of Klipper's `load_cell/dump_force` stream, as `handle.klippyStream`
 * delivers them: `{ data: [[time, force_g | null, counts, tare | null], …] }`.
 *
 * - `time` is a monotonic clock of the printer, used only for the x axis.
 * - `force_g` is null until the load cell is calibrated; then the trace is
 *   `counts − tare` and the axis says "counts" instead of grams.
 */

export type ForceUnit = 'g' | 'counts';

export interface ForceSample {
  time: number;
  value: number;
}

export interface ForceBatch {
  unit: ForceUnit;
  samples: ForceSample[];
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/** Rows that are not arrays of the expected shape are skipped; nothing throws. */
export function parseForceBatch(params: unknown): ForceBatch {
  const rows = (params as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return { unit: 'g', samples: [] };

  let calibrated = true;
  const raw: Array<{ time: number; g: number | null; counts: number | null; tare: number }> = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const time = num(row[0]);
    if (time === null) continue;
    const g = num(row[1]);
    if (g === null) calibrated = false;
    raw.push({ time, g, counts: num(row[2]), tare: num(row[3]) ?? 0 });
  }

  const unit: ForceUnit = calibrated ? 'g' : 'counts';
  const samples: ForceSample[] = [];
  for (const r of raw) {
    const value = unit === 'g' ? r.g : r.counts === null ? null : r.counts - r.tare;
    if (value !== null) samples.push({ time: r.time, value });
  }
  return { unit, samples };
}

/**
 * Averages samples into bins of `binSeconds`: the sensor runs at tens to
 * hundreds of Hz, the chart needs a point every few tens of milliseconds.
 * The bin is stamped with the time of its last sample.
 */
export function binSamples(samples: readonly ForceSample[], binSeconds: number): ForceSample[] {
  if (binSeconds <= 0 || samples.length === 0) return samples.slice();
  const out: ForceSample[] = [];
  let start = samples[0]!.time;
  let sum = 0;
  let n = 0;
  let lastTime = start;
  for (const s of samples) {
    if (s.time - start >= binSeconds && n > 0) {
      out.push({ time: lastTime, value: sum / n });
      start = s.time;
      sum = 0;
      n = 0;
    }
    sum += s.value;
    n++;
    lastTime = s.time;
  }
  if (n > 0) out.push({ time: lastTime, value: sum / n });
  return out;
}
