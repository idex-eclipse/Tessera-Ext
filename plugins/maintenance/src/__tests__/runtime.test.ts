import { describe, expect, it } from 'vitest';

import { MaintenanceRuntime, toolsFromObjectList, type MoonrakerLike } from '../core/runtime';
import { stateKey, type SettingsLike } from '../core/storage';
import type { WizardAnswers } from '../core/types';
import { defaultAnswers } from '../core/presets';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

function fakeSettings() {
  const data: Record<string, unknown> = {};
  const listeners = new Set<(k: string, v: unknown) => void>();
  const api: SettingsLike = {
    get: <T,>(k: string) => data[k] as T | undefined,
    set: (k, v) => {
      data[k] = JSON.parse(JSON.stringify(v));
      listeners.forEach((l) => l(k, v));
    },
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return { data, api, emit: (k: string) => listeners.forEach((l) => l(k, undefined)) };
}

function fakeMoonraker(opts: { objects?: string[]; totals?: { jobs: number; seconds: number; mm: number } } = {}) {
  const totals = { ...(opts.totals ?? { jobs: 0, seconds: 0, mm: 0 }) };
  let printStatsCb: ((d: unknown) => void) | null = null;
  let historyCb: ((p: unknown) => void) | null = null;
  let fail = false;
  const handle: MoonrakerLike = {
    request: async <T,>(method: string): Promise<T> => {
      if (fail) throw new Error('offline');
      if (method === 'printer.objects.list') return { objects: opts.objects ?? ['extruder', 'heater_bed'] } as T;
      if (method === 'server.history.totals') {
        return {
          job_totals: { total_jobs: totals.jobs, total_print_time: totals.seconds, total_filament_used: totals.mm },
        } as T;
      }
      throw new Error(method);
    },
    subscribe: (_o, cb) => {
      printStatsCb = cb;
      return () => {};
    },
    onNotify: (ev, cb) => {
      if (ev === 'notify_history_changed') historyCb = cb;
      return () => {};
    },
    onReady: () => () => {},
  };
  return {
    handle,
    totals,
    setFail: (v: boolean) => (fail = v),
    printStats: (d: unknown) => printStatsCb?.({ print_stats: d }),
    historyChanged: () => historyCb?.([]),
  };
}

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

async function boot(m = fakeMoonraker(), s = fakeSettings(), now = { t: T0 }) {
  const rt = new MaintenanceRuntime({
    printerId: 'p1',
    settings: s.api,
    moonraker: m.handle,
    now: () => now.t,
    genId: (() => {
      let i = 0;
      return () => `id${++i}`;
    })(),
    tickMs: 0,
  });
  rt.start();
  await flush();
  return { rt, m, s, now };
}

describe('runtime', () => {
  it('finds the extruders from the object list', () => {
    expect(toolsFromObjectList({ objects: ['extruder', 'extruder1', 'extruder_stepper x', 'heater_bed'] })).toEqual(['extruder', 'extruder1']);
    expect(toolsFromObjectList(null)).toEqual([]);
  });

  it('creates and SAVES the default state on first run, so the baseline does not move on reload', async () => {
    const { rt, s } = await boot(fakeMoonraker({ totals: { jobs: 3, seconds: 7200, mm: 1e6 } }));
    expect(rt.state?.tasks.some((t) => t.id === 'nozzle:extruder')).toBe(true);
    expect(s.data[stateKey('p1')]).toBeDefined();
    const saved = s.data[stateKey('p1')] as { tasks: Array<{ id: string; counter: { baseline: { jobs: number } } }> };
    expect(saved.tasks.find((t) => t.id === 'bed-wash')!.counter.baseline.jobs).toBe(3);
  });

  it('does not rebuild a state that is already saved', async () => {
    const first = await boot();
    const s = first.s;
    first.rt.stop();
    const { rt } = await boot(fakeMoonraker({ totals: { jobs: 99, seconds: 0, mm: 0 } }), s, { t: T0 + 5 * DAY });
    // the baseline stays where the first run put it; only the last-seen totals follow the printer
    const bed = rt.state?.tasks.find((t) => t.id === 'bed-wash')!;
    expect(bed.counter.baseline.jobs).toBe(0);
    expect(bed.counter.lastSeen?.jobs).toBe(99);
    expect(rt.evals.find((e) => e.taskId === 'bed-wash')!.units[0]!.unit).toBe('days');
  });

  it('creates per-tool tasks for every extruder the printer reports', async () => {
    const { rt } = await boot(fakeMoonraker({ objects: ['extruder', 'extruder1'] }));
    expect(rt.state?.tasks.some((t) => t.id === 'nozzle:extruder1')).toBe(true);
  });

  it('keeps going after History resets the totals', async () => {
    const m = fakeMoonraker({ totals: { jobs: 50, seconds: 100 * 3600, mm: 20e6 } });
    const { rt, s } = await boot(m);
    m.totals.jobs = 60;
    m.totals.seconds = 130 * 3600;
    m.totals.mm = 25e6;
    await rt.refreshTotals();
    m.totals.jobs = 0;
    m.totals.seconds = 0;
    m.totals.mm = 0;
    await rt.refreshTotals();
    const nozzle = rt.evals.find((e) => e.taskId === 'nozzle:extruder')!;
    expect(nozzle.units[0]!.used).toBeCloseTo(5); // 5 km before the reset
    expect((s.data[stateKey('p1')] as { tasks: Array<{ id: string; counter: { carry: { filamentMm: number } } }> }).tasks.find((t) => t.id === 'nozzle:extruder')!.counter.carry.filamentMm).toBe(5e6);
  });

  it('counts the running print before it reaches the history', async () => {
    const { rt, m } = await boot();
    m.printStats({ state: 'printing', print_duration: 3600 * 2, filament_used: 1e6 });
    const feeder = rt.evals.find((e) => e.taskId === 'feeder-lube:extruder')!;
    expect(feeder.units[0]!.used).toBeCloseTo(2);
    m.printStats({ state: 'complete' });
    expect(rt.evals.find((e) => e.taskId === 'feeder-lube:extruder')!.units[0]!.used).toBeCloseTo(0);
  });

  it('a failed totals read is not mistaken for a reset', async () => {
    const m = fakeMoonraker({ totals: { jobs: 10, seconds: 3600, mm: 1e6 } });
    const { rt } = await boot(m);
    m.setFail(true);
    await rt.refreshTotals();
    expect(rt.totals).toMatchObject({ jobs: 10 });
    expect(rt.state!.tasks.find((t) => t.id === 'bed-wash')!.counter.carry.jobs).toBe(0);
  });

  it('pressing an outcome saves the state and the journal and returns the triggered tasks', async () => {
    const { rt, s } = await boot();
    const triggered = rt.press('belts', 'adjusted', ' tightened ', 'Belts');
    expect(triggered).toEqual(['shaper-calib']);
    expect(rt.state!.tasks.find((t) => t.id === 'shaper-calib')!.active).toBe(true);
    expect(rt.journal[0]).toMatchObject({ taskId: 'belts', outcomeId: 'adjusted', note: 'tightened' });
    expect((s.data['printer:p1:journal'] as unknown[]).length).toBe(1);
    expect(rt.press('nope', 'x', undefined, 'x')).toEqual([]);
  });

  it('editing pins the task so the wizard leaves it alone', async () => {
    const { rt } = await boot();
    rt.updateTask('bed-wash', (t) => ({ ...t, intervals: { days: 3 } }));
    const a: WizardAnswers = { ...defaultAnswers(['extruder']), wash: { habit: 'glue-stick' } };
    rt.finishWizard(a);
    expect(rt.state!.tasks.find((t) => t.id === 'bed-wash')!.intervals).toEqual({ days: 3 });
    expect(rt.state!.onboarding.done).toBe(true);
  });

  it('adds and deletes custom tasks and removes the links to them', async () => {
    const { rt } = await boot();
    const id = rt.addCustomTask('Filter', 'interval')!;
    rt.updateTask('bed-wash', (t) => ({ ...t, outcomes: [{ ...t.outcomes[0]!, activates: [id] }] }));
    expect(rt.state!.tasks.some((t) => t.id === id)).toBe(true);
    rt.deleteTask(id);
    expect(rt.state!.tasks.some((t) => t.id === id)).toBe(false);
    expect(rt.state!.tasks.find((t) => t.id === 'bed-wash')!.outcomes[0]!.activates).toEqual([]);
    // built-in tasks cannot be deleted
    rt.deleteTask('bed-wash');
    expect(rt.state!.tasks.some((t) => t.id === 'bed-wash')).toBe(true);
  });

  it('picks up a change made by another browser and ignores the echo of its own write', async () => {
    const { rt, s } = await boot();
    let emits = 0;
    rt.subscribe(() => (emits += 1));
    rt.updateSettings({ notifications: false });
    const afterOwn = emits;
    expect(rt.state!.settings.notifications).toBe(false);

    // another browser turns it back on
    const remote = JSON.parse(JSON.stringify(s.data[stateKey('p1')])) as { settings: { notifications: boolean } };
    remote.settings.notifications = true;
    s.data[stateKey('p1')] = remote;
    s.emit(stateKey('p1'));
    expect(rt.state!.settings.notifications).toBe(true);
    expect(emits).toBeGreaterThan(afterOwn);
  });

  it('re-evaluates on the clock for the "days" unit', async () => {
    const { rt, now } = await boot();
    expect(rt.evals.find((e) => e.taskId === 'bed-wash')!.status).toBe('ok');
    now.t = T0 + 8 * DAY;
    await rt.refreshTotals();
    expect(rt.evals.find((e) => e.taskId === 'bed-wash')!.status).toBe('overdue');
  });
});
