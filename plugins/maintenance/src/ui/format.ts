/** Small presentation helpers shared by the elements. */
import type { OutcomeLike } from './types-ui';
import type { Task, TaskEvaluation, TaskStatus, Unit, UnitProgress } from '../core/types';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A number as people read it: hours and km with one/two decimals, counts as integers. */
export function fmtNumber(unit: Unit, v: number): string {
  switch (unit) {
    case 'hours':
      return String(Math.round(v * 10) / 10);
    case 'filamentKm':
      return String(Math.round(v * 100) / 100);
    default:
      return String(Math.floor(v + 1e-9));
  }
}

/** "12.3 / 1000 print hours" */
export function fmtProgress(t: Translate, p: UnitProgress): string {
  return t(`maintenance.unit.${p.unit}`, {
    used: fmtNumber(p.unit, Math.min(p.used, p.interval)),
    interval: fmtNumber(p.unit, p.interval),
  });
}

/** Task title: custom tasks carry their own name, built-in ones are named through i18n. */
export function taskName(t: Translate, task: Task): string {
  return task.name?.trim() || t(`maintenance.task.${task.defId}.name`);
}

export function outcomeLabel(t: Translate, o: OutcomeLike): string {
  return o.labelKey ? t(o.labelKey) : (o.label ?? o.id);
}

export function statusKey(s: TaskStatus): string {
  return `maintenance.status.${s}`;
}

/** Fraction 0..1 of the interval used up by the most advanced unit (for the bar). */
export function fraction(p: UnitProgress): number {
  return Math.max(0, Math.min(1, p.used / p.interval));
}

export function worstUnit(e: TaskEvaluation): UnitProgress | undefined {
  return [...e.units].sort((a, b) => b.used / b.interval - a.used / a.interval)[0];
}

/** Route of a Calibrations tab, as a hash link (the host router is hash based). */
export function calibrationsHref(printerId: string, tab: string): string {
  return `#/p/${encodeURIComponent(printerId)}/calibrations?section=${tab === 'belts' ? 'shaper' : tab}`;
}

/**
 * The text of a reminder, already translated (the host's notification API takes plain
 * text). A task that another card requested says so instead of quoting a timer.
 */
export function notifyText(t: Translate, task: Task, ev: TaskEvaluation, level: 'soon' | 'overdue'): string {
  const name = task.tool ? `${taskName(t, task)} (${task.tool})` : taskName(t, task);
  if (ev.triggered) return t('maintenance.notify.triggered', { task: name });
  const u = worstUnit(ev);
  const progress = u ? fmtProgress(t, u) : '';
  return t(level === 'soon' ? 'maintenance.notify.soon' : 'maintenance.notify.overdue', { task: name, progress });
}

/** Route of the maintenance tab on the Machine page. */
export function maintenanceHref(printerId: string): string {
  return `#/p/${encodeURIComponent(printerId)}/machine?section=${encodeURIComponent('tessera/maintenance/maintenance')}`;
}
