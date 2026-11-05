/**
 * First-run wizard: turns the user's answers about their hardware and consumables into
 * intervals and enabled flags.
 *
 * The right interval is not universal (liquid oil on ball rails needs a week, lithium
 * grease a month, carbon rails no lubrication at all), so the wizard asks instead of
 * guessing. Values come from the manufacturers' usual recommendations and are only a
 * starting point: the user can still edit every task, and a task the user has edited
 * (`customized`) is never overwritten by a repeated wizard run.
 */
import { DEFAULT_TOOL } from './defaults';
import type { FeederType, Intervals, MaintenanceState, NozzleType, RailType, Task, WizardAnswers } from './types';

/** Days between lubrications of one axis, by rail type; null = no lubrication. */
export const RAIL_LUBE_DAYS: Record<RailType, number | null> = {
  'ball-liquid': 7,
  'ball-grease': 30,
  carbon: null,
  none: null,
};

export const NOZZLE_KM: Record<Exclude<NozzleType, 'custom'>, number> = {
  /** Brass wears fast and must not see abrasive filaments. */
  brass: 10,
  /** Hardened steel and tip-hardened nozzles: the lower end of the 80-100 km range. */
  hardened: 80,
};

/** Print hours between gearbox lubrications. */
export const FEEDER_HOURS: Record<FeederType, number> = { regular: 1000, planetary: 500 };

export const BELTS_DAYS = 90;
export const WASH_DAYS = 7;

export function defaultAnswers(tools: string[]): WizardAnswers {
  const list = tools.length > 0 ? tools : [DEFAULT_TOOL];
  return {
    bedCheck: true,
    wash: { habit: 'normal' },
    rails: { x: 'ball-grease', y: 'ball-grease', z: 'ball-grease' },
    belts: true,
    nozzle: Object.fromEntries(list.map((t) => [t, { type: 'brass' as const }])),
    feeder: Object.fromEntries(list.map((t) => [t, { type: 'regular' as const }])),
  };
}

/** Kilometres of filament for a nozzle answer. */
export function nozzleKm(a: { type: NozzleType; km?: number }): number {
  if (a.type === 'custom') return a.km && a.km > 0 ? a.km : NOZZLE_KM.brass;
  return NOZZLE_KM[a.type];
}

interface Patch {
  enabled?: boolean;
  intervals?: Intervals;
  details?: Record<string, string>;
}

/**
 * Applies the answers. Tasks the user edited by hand are left alone; the answers are still
 * stored so the next wizard run offers the same choices.
 */
export function applyAnswers(state: MaintenanceState, answers: WizardAnswers): MaintenanceState {
  const patches = new Map<string, Patch>();

  patches.set('bed-check', { enabled: answers.bedCheck });

  const wash: Intervals =
    answers.wash.habit === 'glue-stick'
      ? { prints: 1 }
      : { days: answers.wash.habit === 'custom' && (answers.wash.days ?? 0) > 0 ? answers.wash.days : WASH_DAYS };
  patches.set('bed-wash', { enabled: true, intervals: wash });

  // One card for all axes: the shortest interval wins, the types are listed on the card.
  const axes = (['x', 'y', 'z'] as const).map((a) => [a, answers.rails[a]] as const);
  const lubeDays = axes.flatMap(([, t]) => (RAIL_LUBE_DAYS[t] === null ? [] : [RAIL_LUBE_DAYS[t]]));
  const railDetails = Object.fromEntries(axes.map(([a, t]) => [a, t]));
  patches.set('lube-axes', {
    enabled: lubeDays.length > 0,
    intervals: { days: lubeDays.length > 0 ? Math.min(...lubeDays) : 30 },
    details: railDetails,
  });
  patches.set('rails-clean', { enabled: axes.some(([, t]) => t === 'carbon'), details: railDetails });

  patches.set('belts', { enabled: answers.belts, intervals: { days: BELTS_DAYS } });

  for (const [tool, a] of Object.entries(answers.nozzle)) {
    patches.set(`nozzle:${tool}`, { enabled: true, intervals: { filamentKm: nozzleKm(a) } });
  }
  for (const [tool, a] of Object.entries(answers.feeder)) {
    patches.set(`feeder-lube:${tool}`, { enabled: true, intervals: { hours: FEEDER_HOURS[a.type] } });
  }

  const tasks = state.tasks.map((t): Task => {
    const p = patches.get(t.id);
    if (!p || t.customized) return t;
    return {
      ...t,
      enabled: p.enabled ?? t.enabled,
      intervals: p.intervals ?? t.intervals,
      details: p.details ?? t.details,
    };
  });
  return { ...state, tasks, onboarding: { done: true, answers } };
}

/** Marks the wizard as skipped: the built-in defaults stay as they are. */
export function skipOnboarding(state: MaintenanceState): MaintenanceState {
  return { ...state, onboarding: { done: true, answers: null } };
}
