/**
 * The built-in task list and its default intervals.
 *
 * Defaults are only a starting point: the right interval depends on the consumables and
 * the hardware (rail type, nozzle material, gearbox), which is why the first-run wizard
 * (presets.ts) replaces them with the answers. Names and explanations are NOT here; they
 * come from i18n by `defId` (`maintenance.task.<defId>.name` / `.why`).
 */
import { newCounter } from './counters';
import type { MaintenanceState, Outcome, Task, TaskKind, Totals } from './types';
import { STATE_VERSION } from './types';

/** The extruder used when the printer reports none (a single-extruder printer). */
export const DEFAULT_TOOL = 'extruder';

/** Id of a per-tool task: `nozzle:extruder1`. */
export function toolTaskId(defId: string, tool: string): string {
  return `${defId}:${tool}`;
}

const out = (id: string, resetsTimer: boolean, extra: Partial<Outcome> = {}): Outcome => ({
  id,
  labelKey: `maintenance.outcome.${id}`,
  resetsTimer,
  activates: [],
  ...extra,
});

interface DefInput {
  id: string;
  defId: string;
  kind: TaskKind;
  tool?: string;
  intervals?: Task['intervals'];
  outcomes: Outcome[];
  enabled?: boolean;
  guard?: boolean;
  link?: Task['link'];
}

function makeTask(input: DefInput, totals: Totals, now: number): Task {
  return {
    id: input.id,
    defId: input.defId,
    kind: input.kind,
    tool: input.tool,
    enabled: input.enabled ?? true,
    active: false,
    customized: false,
    intervals: { ...(input.intervals ?? {}) },
    lead: {},
    guard: input.guard ?? true,
    notify: true,
    outcomes: input.outcomes,
    counter: newCounter(totals, now),
    link: input.link,
    lastDone: null,
    activatedAt: null,
    notified: null,
  };
}

/** Tasks that exist once per printer. */
function printerTasks(totals: Totals, now: number): Task[] {
  return [
    makeTask({ id: 'bed-check', defId: 'bed-check', kind: 'precheck', outcomes: [] }, totals, now),
    makeTask(
      { id: 'bed-wash', defId: 'bed-wash', kind: 'interval', intervals: { days: 7 }, outcomes: [out('done', true)] },
      totals,
      now,
    ),
    makeTask(
      { id: 'lube-axes', defId: 'lube-axes', kind: 'interval', intervals: { days: 30 }, outcomes: [out('done', true)] },
      totals,
      now,
    ),
    // Carbon rails are cleaned, not lubricated; the wizard enables this one for them.
    makeTask(
      {
        id: 'rails-clean',
        defId: 'rails-clean',
        kind: 'interval',
        intervals: { days: 30 },
        enabled: false,
        outcomes: [out('done', true)],
      },
      totals,
      now,
    ),
    makeTask(
      {
        id: 'belts',
        defId: 'belts',
        kind: 'interval',
        intervals: { days: 90 },
        link: { calibrations: 'belts' },
        outcomes: [out('checked', true), out('adjusted', true, { activates: ['shaper-calib'] })],
      },
      totals,
      now,
    ),
    makeTask(
      {
        id: 'shaper-calib',
        defId: 'shaper-calib',
        kind: 'followup',
        link: { calibrations: 'shaper' },
        outcomes: [out('done', false, { completes: true })],
      },
      totals,
      now,
    ),
  ];
}

/** Tasks that exist once per extruder. */
export function toolTasks(tool: string, totals: Totals, now: number): Task[] {
  const nozzle = toolTaskId('nozzle', tool);
  const zoffset = toolTaskId('zoffset', tool);
  const hot = toolTaskId('hot-tighten', tool);
  return [
    makeTask(
      {
        id: nozzle,
        defId: 'nozzle',
        kind: 'interval',
        tool,
        intervals: { filamentKm: 10 },
        outcomes: [out('checked', true), out('replaced', true, { activates: [zoffset, hot] })],
      },
      totals,
      now,
    ),
    makeTask(
      {
        id: zoffset,
        defId: 'zoffset',
        kind: 'followup',
        tool,
        link: { calibrations: 'probe' },
        outcomes: [out('done', false, { completes: true })],
      },
      totals,
      now,
    ),
    makeTask(
      { id: hot, defId: 'hot-tighten', kind: 'followup', tool, outcomes: [out('done', false, { completes: true })] },
      totals,
      now,
    ),
    makeTask(
      {
        id: toolTaskId('feeder-lube', tool),
        defId: 'feeder-lube',
        kind: 'interval',
        tool,
        intervals: { hours: 1000 },
        outcomes: [out('done', true)],
      },
      totals,
      now,
    ),
  ];
}

/** The state of a printer that has never been set up. */
export function createDefaultState(tools: string[], totals: Totals, now: number): MaintenanceState {
  const list = tools.length > 0 ? tools : [DEFAULT_TOOL];
  return {
    v: STATE_VERSION,
    onboarding: { done: false, answers: null },
    settings: { notifications: true, guard: true },
    tasks: [...printerTasks(totals, now), ...list.flatMap((t) => toolTasks(t, totals, now))],
  };
}

/**
 * Adds the per-tool tasks of extruders that appeared after the first setup (an IDEX
 * conversion, a new tool). Existing tasks are never touched. Returns the same state when
 * nothing is missing.
 */
export function syncTools(state: MaintenanceState, tools: string[], totals: Totals, now: number): MaintenanceState {
  const have = new Set(state.tasks.map((t) => t.id));
  const add = tools.filter((t) => !have.has(toolTaskId('nozzle', t))).flatMap((t) => toolTasks(t, totals, now));
  return add.length === 0 ? state : { ...state, tasks: [...state.tasks, ...add] };
}

/** A new user-made task. */
export function newCustomTask(
  id: string,
  name: string,
  kind: 'interval' | 'followup',
  totals: Totals,
  now: number,
): Task {
  return {
    ...makeTask(
      { id, defId: 'custom', kind, outcomes: [out('done', kind === 'interval', kind === 'followup' ? { completes: true } : {})] },
      totals,
      now,
    ),
    name,
    customized: true,
    // A custom interval task has to say when it is due; the editor fills this in.
    intervals: kind === 'interval' ? { days: 30 } : {},
  };
}
