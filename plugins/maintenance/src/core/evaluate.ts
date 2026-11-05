/**
 * Turns the state and the current counters into statuses: ok / soon / overdue / off.
 * Pure functions, no I/O, so everything can be tested without a printer.
 */
import { setUnits, usedOf } from './counters';
import type {
  Intervals,
  MaintenanceState,
  RunningUsage,
  Task,
  TaskEvaluation,
  TaskStatus,
  Totals,
  Unit,
  UnitProgress,
} from './types';

/** Smallest meaningful lead per unit (a lead of 0.3 prints makes no sense). */
const MIN_LEAD: Record<Unit, number> = { hours: 1, prints: 1, days: 1, filamentKm: 0.1 };

/**
 * How early to start reminding for one unit: the user's value, else 10 % of the interval
 * (at least a sensible minimum). Never more than half the interval, otherwise a task with
 * an interval of one print would be "soon" from the very start.
 */
export function leadOf(task: Pick<Task, 'lead'>, unit: Unit, interval: number): number {
  const explicit = task.lead[unit];
  const base = typeof explicit === 'number' && explicit >= 0 ? explicit : Math.max(MIN_LEAD[unit], interval * 0.1);
  return Math.min(base, interval / 2);
}

const RANK: Record<TaskStatus, number> = { off: 0, ok: 1, soon: 2, overdue: 3 };

/** The more urgent of two statuses. */
export function worst(a: TaskStatus, b: TaskStatus): TaskStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

export function evaluateTask(
  task: Task,
  totals: Totals,
  running: RunningUsage,
  now: number,
): TaskEvaluation {
  const none: TaskEvaluation = { taskId: task.id, status: 'off', triggered: false, units: [] };
  if (!task.enabled) return none;

  if (task.kind === 'precheck') return { ...none, status: 'ok' };

  if (task.kind === 'followup') {
    // A follow-up has no timer: it is due as long as an outcome of another task has
    // activated it and nobody has completed it yet.
    return task.active ? { ...none, status: 'overdue', triggered: true } : none;
  }

  const units: UnitProgress[] = setUnits(task.intervals).map(([unit, interval]) => {
    const used = usedOf(task.counter, unit, totals, running, now);
    const remaining = interval - used;
    const lead = leadOf(task, unit, interval);
    const status = remaining <= 0 ? 'overdue' : remaining <= lead ? 'soon' : 'ok';
    return { unit, used, interval, remaining, lead, status };
  });

  let status: TaskStatus = units.length > 0 ? 'ok' : 'off';
  for (const u of units) status = worst(status, u.status);
  // Triggered by a link ("belts adjusted" -> "shaper calibration"): due now, whatever the timer says.
  if (task.active) status = 'overdue';
  return { taskId: task.id, status, triggered: task.active, units };
}

export function evaluateAll(
  state: MaintenanceState,
  totals: Totals,
  running: RunningUsage,
  now: number,
): TaskEvaluation[] {
  return state.tasks.map((t) => evaluateTask(t, totals, running, now));
}

/** Counts for the summary and the widget. */
export function summarize(evals: TaskEvaluation[]): { overdue: number; soon: number } {
  let overdue = 0;
  let soon = 0;
  for (const e of evals) {
    if (e.status === 'overdue') overdue += 1;
    else if (e.status === 'soon') soon += 1;
  }
  return { overdue, soon };
}

/** Tasks ordered by urgency (overdue first, then by how little is left). */
export function byUrgency(state: MaintenanceState, evals: TaskEvaluation[]): Array<{ task: Task; evaluation: TaskEvaluation }> {
  const byId = new Map(evals.map((e) => [e.taskId, e]));
  const rows = state.tasks.flatMap((task) => {
    const evaluation = byId.get(task.id);
    return evaluation && evaluation.status !== 'off' ? [{ task, evaluation }] : [];
  });
  const fraction = (e: TaskEvaluation): number =>
    e.units.length === 0 ? 0 : Math.min(...e.units.map((u) => u.remaining / u.interval));
  return rows.sort(
    (a, b) => RANK[b.evaluation.status] - RANK[a.evaluation.status] || fraction(a.evaluation) - fraction(b.evaluation),
  );
}

export type { Intervals };
