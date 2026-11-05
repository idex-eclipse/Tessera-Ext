/**
 * Usage counters.
 *
 * Moonraker only knows printer-wide totals (`server.history.totals`), and the History page
 * can reset them to zero. A task therefore keeps its own baseline instead of trusting the
 * raw totals: `used = carry + (totals - baseline) + running print + manual adjustment`.
 */
import type { Counter, Intervals, RunningUsage, Task, Totals, Unit } from './types';

export const ZERO_TOTALS: Totals = { printSeconds: 0, jobs: 0, filamentMm: 0 };

const DAY_MS = 86_400_000;

/** A fresh counter that starts counting from `totals` at `now`. */
export function newCounter(totals: Totals, now: number): Counter {
  return {
    baseline: { ...totals },
    since: now,
    carry: { ...ZERO_TOTALS },
    adjust: {},
    lastSeen: { ...totals },
  };
}

/**
 * Reads `server.history.totals`. Moonraker answers `{ job_totals: { total_jobs,
 * total_print_time, total_filament_used, … } }`; filament is in millimetres. Anything
 * unexpected gives null so the caller keeps the last known totals instead of treating the
 * glitch as a reset.
 */
export function parseTotals(response: unknown): Totals | null {
  const jt = (response as { job_totals?: Record<string, unknown> } | null | undefined)?.job_totals;
  if (!jt || typeof jt !== 'object') return null;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const printSeconds = num(jt.total_print_time);
  const jobs = num(jt.total_jobs);
  const filamentMm = num(jt.total_filament_used);
  if (printSeconds === null || jobs === null || filamentMm === null) return null;
  return { printSeconds, jobs, filamentMm };
}

/**
 * What the running print has consumed. History only gets the job when it ends, so without
 * this a long print would not count until it finished.
 */
export function parseRunning(printStats: unknown): RunningUsage {
  const ps = printStats as { state?: unknown; print_duration?: unknown; filament_used?: unknown } | null | undefined;
  const active = ps?.state === 'printing' || ps?.state === 'paused';
  if (!active) return { ...ZERO_TOTALS };
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return { printSeconds: num(ps?.print_duration), jobs: 0, filamentMm: num(ps?.filament_used) };
}

/**
 * Brings a task's counter in line with new totals. A dimension whose total went DOWN was
 * reset in History: the part consumed before the reset is moved into `carry` and the
 * baseline restarts from the new total. Returns the same object when nothing changed.
 */
export function syncCounter(counter: Counter, totals: Totals): Counter {
  const last = counter.lastSeen;
  if (last && sameTotals(last, totals)) return counter;

  const baseline = { ...counter.baseline };
  const carry = { ...counter.carry };
  if (last) {
    for (const d of ['printSeconds', 'jobs', 'filamentMm'] as const) {
      if (totals[d] < last[d]) {
        carry[d] += Math.max(0, last[d] - baseline[d]);
        baseline[d] = totals[d];
      }
    }
  }
  return { ...counter, baseline, carry, lastSeen: { ...totals } };
}

function sameTotals(a: Totals, b: Totals): boolean {
  return a.printSeconds === b.printSeconds && a.jobs === b.jobs && a.filamentMm === b.filamentMm;
}

/** Consumption of one unit since the counter's reset. */
export function usedOf(
  counter: Counter,
  unit: Unit,
  totals: Totals,
  running: RunningUsage,
  now: number,
): number {
  const adjust = counter.adjust[unit] ?? 0;
  const delta = (d: keyof Totals): number =>
    counter.carry[d] + Math.max(0, totals[d] - counter.baseline[d]) + running[d];
  switch (unit) {
    case 'hours':
      return Math.max(0, delta('printSeconds') / 3600 + adjust);
    case 'prints':
      return Math.max(0, delta('jobs') + adjust);
    case 'filamentKm':
      return Math.max(0, delta('filamentMm') / 1e6 + adjust);
    case 'days':
      return Math.max(0, (now - counter.since) / DAY_MS + adjust);
  }
}

/** The units a task actually has an interval for. */
export function setUnits(intervals: Intervals): Array<[Unit, number]> {
  const out: Array<[Unit, number]> = [];
  for (const u of ['hours', 'prints', 'days', 'filamentKm'] as const) {
    const v = intervals[u];
    if (typeof v === 'number' && v > 0) out.push([u, v]);
  }
  return out;
}

/** Restarts a task's timer from the given totals (an outcome with `resetsTimer`). */
export function resetTask<T extends Pick<Task, 'counter'>>(task: T, totals: Totals, now: number): T {
  return { ...task, counter: newCounter(totals, now) };
}
