import { describe, expect, it } from 'vitest';

import { newCounter, parseRunning, parseTotals, syncCounter, usedOf, ZERO_TOTALS } from '../core/counters';
import { createDefaultState, newCustomTask, syncTools, toolTaskId } from '../core/defaults';
import { evaluateAll, evaluateTask, leadOf, summarize } from '../core/evaluate';
import { applyOutcome, appendJournal, JOURNAL_LIMIT, validateGraph } from '../core/graph';
import { decideGuard } from '../core/guard';
import { planNotifications } from '../core/notify';
import { applyAnswers, defaultAnswers, skipOnboarding } from '../core/presets';
import { readJournal, readState, stateKey, watchPrinter, writeJournal, writeState } from '../core/storage';
import type { MaintenanceState, Task, Totals } from '../core/types';

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const totals = (printHours = 0, jobs = 0, filamentKm = 0): Totals => ({
  printSeconds: printHours * 3600,
  jobs,
  filamentMm: filamentKm * 1e6,
});

function fresh(t: Totals = totals(), tools = ['extruder']): MaintenanceState {
  const s = createDefaultState(tools, t, T0);
  return { ...s, onboarding: { done: true, answers: null } };
}

const task = (s: MaintenanceState, id: string): Task => s.tasks.find((t) => t.id === id)!;
const evalOf = (s: MaintenanceState, id: string, t: Totals, now = T0, running = ZERO_TOTALS) =>
  evaluateTask(task(s, id), t, running, now);

describe('counters', () => {
  it('counts every unit since the baseline', () => {
    const c = newCounter(totals(10, 5, 2), T0);
    const now = T0 + 3 * DAY;
    const t = totals(14, 9, 5);
    expect(usedOf(c, 'hours', t, ZERO_TOTALS, now)).toBeCloseTo(4);
    expect(usedOf(c, 'prints', t, ZERO_TOTALS, now)).toBe(4);
    expect(usedOf(c, 'filamentKm', t, ZERO_TOTALS, now)).toBeCloseTo(3);
    expect(usedOf(c, 'days', t, ZERO_TOTALS, now)).toBeCloseTo(3);
  });

  it('adds the running print, which is not in the history totals yet', () => {
    const c = newCounter(totals(), T0);
    const running = parseRunning({ state: 'printing', print_duration: 7200, filament_used: 5e5 });
    expect(usedOf(c, 'hours', totals(), running, T0)).toBeCloseTo(2);
    expect(usedOf(c, 'filamentKm', totals(), running, T0)).toBeCloseTo(0.5);
  });

  it('ignores print_stats when nothing is printing', () => {
    expect(parseRunning({ state: 'standby', print_duration: 99, filament_used: 99 })).toEqual(ZERO_TOTALS);
    expect(parseRunning(undefined)).toEqual(ZERO_TOTALS);
  });

  it('keeps the progress when History resets the totals', () => {
    let c = newCounter(totals(100, 50, 20), T0);
    c = syncCounter(c, totals(130, 60, 25)); // 30 h, 10 prints, 5 km consumed
    // the user presses "reset totals" in History
    c = syncCounter(c, totals(0, 0, 0));
    expect(usedOf(c, 'hours', totals(0, 0, 0), ZERO_TOTALS, T0)).toBeCloseTo(30);
    // and printing goes on from zero
    c = syncCounter(c, totals(2, 1, 0.5));
    expect(usedOf(c, 'hours', totals(2, 1, 0.5), ZERO_TOTALS, T0)).toBeCloseTo(32);
    expect(usedOf(c, 'prints', totals(2, 1, 0.5), ZERO_TOTALS, T0)).toBe(11);
    expect(usedOf(c, 'filamentKm', totals(2, 1, 0.5), ZERO_TOTALS, T0)).toBeCloseTo(5.5);
  });

  it('returns the same counter object when the totals did not change', () => {
    const c = newCounter(totals(1, 1, 1), T0);
    expect(syncCounter(c, totals(1, 1, 1))).toBe(c);
  });

  it('applies the manual adjustment in either direction and never goes negative', () => {
    const c = { ...newCounter(totals(), T0), adjust: { hours: 5, prints: -3 } };
    expect(usedOf(c, 'hours', totals(1), ZERO_TOTALS, T0)).toBeCloseTo(6);
    expect(usedOf(c, 'prints', totals(), ZERO_TOTALS, T0)).toBe(0);
  });

  it('parses Moonraker history totals and rejects garbage', () => {
    expect(
      parseTotals({ job_totals: { total_jobs: 4, total_print_time: 7200, total_filament_used: 3e6, total_time: 9 } }),
    ).toEqual({ printSeconds: 7200, jobs: 4, filamentMm: 3e6 });
    expect(parseTotals({ job_totals: { total_jobs: 'x' } })).toBeNull();
    expect(parseTotals(null)).toBeNull();
    expect(parseTotals({ job_totals: { total_jobs: -1, total_print_time: 0, total_filament_used: 0 } })).toBeNull();
  });
});

describe('evaluation', () => {
  it('is ok, then soon at the lead, then overdue (days)', () => {
    const s = fresh(); // bed-wash: 7 days, lead = max(1, 0.7) = 1 day
    expect(evalOf(s, 'bed-wash', totals(), T0 + 2 * DAY).status).toBe('ok');
    expect(evalOf(s, 'bed-wash', totals(), T0 + 6.5 * DAY).status).toBe('soon');
    expect(evalOf(s, 'bed-wash', totals(), T0 + 7 * DAY).status).toBe('overdue');
  });

  it('takes the most urgent unit when a task has several', () => {
    const s = fresh();
    const t: Task = { ...task(s, 'bed-wash'), intervals: { days: 30, prints: 10 } };
    const ev = evaluateTask(t, totals(0, 10), ZERO_TOTALS, T0 + DAY);
    expect(ev.status).toBe('overdue');
    expect(ev.units.map((u) => [u.unit, u.status])).toEqual([
      ['prints', 'overdue'],
      ['days', 'ok'],
    ]);
  });

  it('caps the lead at half the interval so a one-print task is not soon from the start', () => {
    const s = fresh();
    const t: Task = { ...task(s, 'bed-wash'), intervals: { prints: 1 } };
    expect(leadOf(t, 'prints', 1)).toBe(0.5);
    expect(evaluateTask(t, totals(0, 0), ZERO_TOTALS, T0).status).toBe('ok');
    expect(evaluateTask(t, totals(0, 1), ZERO_TOTALS, T0).status).toBe('overdue');
  });

  it('honours an explicit lead', () => {
    const s = fresh();
    const t: Task = { ...task(s, 'nozzle:extruder'), lead: { filamentKm: 3 } }; // interval 10 km
    expect(evaluateTask(t, totals(0, 0, 6), ZERO_TOTALS, T0).status).toBe('ok');
    expect(evaluateTask(t, totals(0, 0, 7.5), ZERO_TOTALS, T0).status).toBe('soon');
  });

  it('a disabled task is off; a follow-up is overdue only while active', () => {
    let s = fresh();
    s = { ...s, tasks: s.tasks.map((t) => (t.id === 'bed-wash' ? { ...t, enabled: false } : t)) };
    expect(evalOf(s, 'bed-wash', totals(), T0 + 100 * DAY).status).toBe('off');
    expect(evalOf(s, 'shaper-calib', totals()).status).toBe('off');
    s = { ...s, tasks: s.tasks.map((t) => (t.id === 'shaper-calib' ? { ...t, active: true } : t)) };
    const ev = evalOf(s, 'shaper-calib', totals());
    expect(ev.status).toBe('overdue');
    expect(ev.triggered).toBe(true);
  });

  it('summarizes the counts', () => {
    const s = fresh();
    const evals = evaluateAll(s, totals(), ZERO_TOTALS, T0 + 8 * DAY);
    expect(summarize(evals).overdue).toBeGreaterThanOrEqual(1);
  });
});

describe('default task list', () => {
  it('matches the agreed defaults', () => {
    const s = fresh();
    expect(task(s, 'bed-wash').intervals).toEqual({ days: 7 });
    expect(task(s, 'lube-axes').intervals).toEqual({ days: 30 });
    expect(task(s, 'belts').intervals).toEqual({ days: 90 });
    expect(task(s, 'nozzle:extruder').intervals).toEqual({ filamentKm: 10 });
    expect(task(s, 'feeder-lube:extruder').intervals).toEqual({ hours: 1000 });
    expect(task(s, 'shaper-calib').kind).toBe('followup');
    expect(task(s, 'zoffset:extruder').kind).toBe('followup');
    expect(task(s, 'hot-tighten:extruder').kind).toBe('followup');
    expect(task(s, 'bed-check').kind).toBe('precheck');
  });

  it('has a valid graph', () => {
    expect(validateGraph(fresh())).toEqual([]);
    expect(validateGraph(fresh(totals(), ['extruder', 'extruder1']))).toEqual([]);
  });

  it('creates per-tool tasks for every extruder and adds missing ones later', () => {
    const s = fresh(totals(), ['extruder']);
    const grown = syncTools(s, ['extruder', 'extruder1'], totals(), T0);
    expect(grown.tasks.some((t) => t.id === toolTaskId('nozzle', 'extruder1'))).toBe(true);
    expect(syncTools(grown, ['extruder', 'extruder1'], totals(), T0)).toBe(grown);
  });
});

describe('outcomes and chains', () => {
  const opts = (label = 'x') => ({ entryId: 'e1', taskLabel: label });

  it('"checked" restarts the timer without activating anything', () => {
    const s = fresh();
    const r = applyOutcome(s, 'belts', 'checked', totals(5, 2, 1), T0 + 90 * DAY, opts())!;
    expect(r.activated).toEqual([]);
    expect(task(r.state, 'belts').lastDone).toBe(T0 + 90 * DAY);
    expect(evalOf(r.state, 'belts', totals(5, 2, 1), T0 + 90 * DAY).status).toBe('ok');
    expect(task(r.state, 'shaper-calib').active).toBe(false);
  });

  it('"adjusted" restarts the belts and activates the shaper calibration', () => {
    const s = fresh();
    const r = applyOutcome(s, 'belts', 'adjusted', totals(), T0 + DAY, opts())!;
    expect(r.activated).toEqual(['shaper-calib']);
    expect(task(r.state, 'shaper-calib').active).toBe(true);
    expect(task(r.state, 'shaper-calib').activatedAt).toBe(T0 + DAY);
  });

  it('"replaced" activates the Z-offset check and the hot tightening', () => {
    const r = applyOutcome(fresh(), 'nozzle:extruder', 'replaced', totals(0, 0, 12), T0, opts())!;
    expect(r.activated.sort()).toEqual(['hot-tighten:extruder', 'zoffset:extruder']);
  });

  it('completing a follow-up deactivates it and keeps it out of the way', () => {
    let s = applyOutcome(fresh(), 'belts', 'adjusted', totals(), T0, opts())!.state;
    s = applyOutcome(s, 'shaper-calib', 'done', totals(), T0 + 1, opts())!.state;
    expect(task(s, 'shaper-calib').active).toBe(false);
    expect(evalOf(s, 'shaper-calib', totals()).status).toBe('off');
  });

  it('a link to a timer task makes it due at once, and its own timer reset clears that', () => {
    // custom card A ("filter changed") triggers the timer task "bed-wash"
    const base = fresh();
    const a = newCustomTask('custom:a', 'A', 'interval', totals(), T0);
    const linked: Task = { ...a, outcomes: [{ ...a.outcomes[0]!, activates: ['bed-wash'] }] };
    let s: MaintenanceState = { ...base, tasks: [...base.tasks, linked] };
    expect(evalOf(s, 'bed-wash', totals(), T0 + DAY).status).toBe('ok');

    const r = applyOutcome(s, 'custom:a', 'done', totals(), T0 + DAY, opts())!;
    expect(r.activated).toEqual(['bed-wash']);
    s = r.state;
    const ev = evalOf(s, 'bed-wash', totals(), T0 + DAY);
    expect(ev.status).toBe('overdue');
    expect(ev.triggered).toBe(true);
    // the timer itself is untouched: only the trigger makes it due
    expect(ev.units[0]!.status).toBe('ok');

    // the user does the work and presses "Done": the timer restarts, the trigger is gone
    s = applyOutcome(s, 'bed-wash', 'done', totals(), T0 + 2 * DAY, opts())!.state;
    const after = evalOf(s, 'bed-wash', totals(), T0 + 2 * DAY);
    expect(after.status).toBe('ok');
    expect(after.triggered).toBe(false);
  });

  it('a triggered timer task notifies once and shows up in the pre-print dialog', () => {
    const base = fresh();
    const a = newCustomTask('custom:a', 'A', 'interval', totals(), T0);
    const linked: Task = { ...a, outcomes: [{ ...a.outcomes[0]!, activates: ['bed-wash'] }] };
    const s = applyOutcome({ ...base, tasks: [...base.tasks, linked] }, 'custom:a', 'done', totals(), T0 + DAY, opts())!.state;
    const evals = evaluateAll(s, totals(), ZERO_TOTALS, T0 + DAY);
    expect(planNotifications(s, evals, T0 + DAY, 'history').items).toEqual([{ taskId: 'bed-wash', level: 'overdue' }]);
    const d = decideGuard(s, evals);
    expect(d.action === 'freeze' && d.overdue).toContain('bed-wash');
  });

  it('does not trigger a task twice and keeps the first trigger time', () => {
    const base = fresh();
    const a = newCustomTask('custom:a', 'A', 'interval', totals(), T0);
    const linked: Task = { ...a, outcomes: [{ ...a.outcomes[0]!, activates: ['bed-wash'] }] };
    let s: MaintenanceState = { ...base, tasks: [...base.tasks, linked] };
    s = applyOutcome(s, 'custom:a', 'done', totals(), T0 + DAY, opts())!.state;
    const second = applyOutcome(s, 'custom:a', 'done', totals(), T0 + 2 * DAY, opts())!;
    expect(second.activated).toEqual([]);
    expect(task(second.state, 'bed-wash').activatedAt).toBe(T0 + DAY);
  });

  it('a task whose outcome resets it and links back to itself ends up triggered', () => {
    const base = fresh();
    const a = newCustomTask('custom:a', 'A', 'interval', totals(), T0);
    const self: Task = { ...a, outcomes: [{ ...a.outcomes[0]!, activates: ['custom:a'] }] };
    const r = applyOutcome({ ...base, tasks: [...base.tasks, self] }, 'custom:a', 'done', totals(), T0, opts())!;
    expect(task(r.state, 'custom:a').active).toBe(true);
  });

  it('does not re-activate a follow-up the user disabled', () => {
    let s = fresh();
    s = { ...s, tasks: s.tasks.map((t) => (t.id === 'shaper-calib' ? { ...t, enabled: false } : t)) };
    const r = applyOutcome(s, 'belts', 'adjusted', totals(), T0, opts())!;
    expect(r.activated).toEqual([]);
  });

  it('writes a journal entry and returns null for unknown cards', () => {
    const r = applyOutcome(fresh(), 'bed-wash', 'done', totals(1, 2, 3), T0, { entryId: 'id', taskLabel: 'Bed wash', note: '  IPA  ' })!;
    expect(r.entry).toMatchObject({ taskId: 'bed-wash', outcomeId: 'done', note: 'IPA', taskLabel: 'Bed wash' });
    expect(applyOutcome(fresh(), 'nope', 'done', totals(), T0, opts())).toBeNull();
    expect(applyOutcome(fresh(), 'bed-wash', 'nope', totals(), T0, opts())).toBeNull();
  });

  it('caps the journal and keeps the newest first', () => {
    let j: ReturnType<typeof appendJournal> = [];
    for (let i = 0; i < JOURNAL_LIMIT + 10; i += 1) {
      j = appendJournal(j, { id: String(i), at: i, taskId: 't', taskLabel: 't', outcomeId: 'done', totals: null });
    }
    expect(j).toHaveLength(JOURNAL_LIMIT);
    expect(j[0]!.id).toBe(String(JOURNAL_LIMIT + 9));
  });
});

describe('graph validation', () => {
  it('reports dangling links as errors and cycles as warnings; a link to a timer task is fine', () => {
    const s = fresh();
    const tasks = s.tasks.map((t): Task => {
      if (t.id === 'bed-wash') return { ...t, outcomes: [{ ...t.outcomes[0]!, activates: ['ghost', 'belts'] }] };
      if (t.id === 'shaper-calib') return { ...t, outcomes: [{ ...t.outcomes[0]!, activates: ['hot-tighten:extruder'] }] };
      if (t.id === 'hot-tighten:extruder') return { ...t, outcomes: [{ ...t.outcomes[0]!, activates: ['shaper-calib'] }] };
      return t;
    });
    const issues = validateGraph({ tasks });
    expect(issues.find((i) => i.code === 'dangling')).toMatchObject({ severity: 'error', target: 'ghost' });
    expect(issues.find((i) => i.code === 'cycle')?.severity).toBe('warning');
    // 'belts' is a timer task and is a valid target
    expect(issues.some((i) => i.target === 'belts')).toBe(false);
  });

  it('treats a task that activates itself as a cycle', () => {
    const s = fresh();
    const tasks = s.tasks.map((t): Task =>
      t.id === 'shaper-calib' ? { ...t, outcomes: [{ ...t.outcomes[0]!, activates: ['shaper-calib'] }] } : t,
    );
    expect(validateGraph({ tasks }).some((i) => i.code === 'cycle')).toBe(true);
  });

  it('reports duplicate ids', () => {
    const s = fresh();
    expect(validateGraph({ tasks: [...s.tasks, s.tasks[0]!] }).some((i) => i.code === 'duplicate-id')).toBe(true);
  });

  it('a user-made chain of custom cards is valid', () => {
    const base = fresh();
    const a = newCustomTask('custom:a', 'A', 'interval', totals(), T0);
    const b = newCustomTask('custom:b', 'B', 'followup', totals(), T0);
    const withLink: Task = { ...a, outcomes: [{ ...a.outcomes[0]!, activates: ['custom:b'] }] };
    expect(validateGraph({ tasks: [...base.tasks, withLink, b] })).toEqual([]);
  });
});

describe('first-run wizard', () => {
  const start = (): MaintenanceState => createDefaultState(['extruder'], totals(), T0);

  it('the defaults answers give the defaults and finish the wizard', () => {
    const s = applyAnswers(start(), defaultAnswers(['extruder']));
    expect(s.onboarding.done).toBe(true);
    expect(task(s, 'bed-wash').intervals).toEqual({ days: 7 });
    expect(task(s, 'lube-axes')).toMatchObject({ enabled: true, intervals: { days: 30 } });
    expect(task(s, 'rails-clean').enabled).toBe(false);
  });

  it('glue stick means washing at every print', () => {
    const a = { ...defaultAnswers(['extruder']), wash: { habit: 'glue-stick' as const } };
    expect(task(applyAnswers(start(), a), 'bed-wash').intervals).toEqual({ prints: 1 });
  });

  it('lubrication takes the shortest interval over the axes', () => {
    const a = { ...defaultAnswers(['extruder']), rails: { x: 'ball-liquid' as const, y: 'ball-grease' as const, z: 'none' as const } };
    const t = task(applyAnswers(start(), a), 'lube-axes');
    expect(t.intervals).toEqual({ days: 7 });
    expect(t.details).toEqual({ x: 'ball-liquid', y: 'ball-grease', z: 'none' });
  });

  it('carbon rails switch lubrication off and cleaning on', () => {
    const a = { ...defaultAnswers(['extruder']), rails: { x: 'carbon' as const, y: 'carbon' as const, z: 'none' as const } };
    const s = applyAnswers(start(), a);
    expect(task(s, 'lube-axes').enabled).toBe(false);
    expect(task(s, 'rails-clean').enabled).toBe(true);
  });

  it('sets nozzle and feeder intervals per extruder', () => {
    const s0 = createDefaultState(['extruder', 'extruder1'], totals(), T0);
    const a = {
      ...defaultAnswers(['extruder', 'extruder1']),
      nozzle: { extruder: { type: 'brass' as const }, extruder1: { type: 'hardened' as const } },
      feeder: { extruder: { type: 'regular' as const }, extruder1: { type: 'planetary' as const } },
    };
    const s = applyAnswers(s0, a);
    expect(task(s, 'nozzle:extruder').intervals).toEqual({ filamentKm: 10 });
    expect(task(s, 'nozzle:extruder1').intervals).toEqual({ filamentKm: 80 });
    expect(task(s, 'feeder-lube:extruder').intervals).toEqual({ hours: 1000 });
    expect(task(s, 'feeder-lube:extruder1').intervals).toEqual({ hours: 500 });
  });

  it('a custom nozzle interval is used, a missing one falls back to brass', () => {
    const a1 = { ...defaultAnswers(['extruder']), nozzle: { extruder: { type: 'custom' as const, km: 40 } } };
    expect(task(applyAnswers(start(), a1), 'nozzle:extruder').intervals).toEqual({ filamentKm: 40 });
    const a2 = { ...defaultAnswers(['extruder']), nozzle: { extruder: { type: 'custom' as const } } };
    expect(task(applyAnswers(start(), a2), 'nozzle:extruder').intervals).toEqual({ filamentKm: 10 });
  });

  it('never overwrites a task the user edited', () => {
    let s = start();
    s = { ...s, tasks: s.tasks.map((t) => (t.id === 'bed-wash' ? { ...t, customized: true, intervals: { days: 3 } } : t)) };
    const a = { ...defaultAnswers(['extruder']), wash: { habit: 'glue-stick' as const } };
    expect(task(applyAnswers(s, a), 'bed-wash').intervals).toEqual({ days: 3 });
  });

  it('skipping keeps the defaults but finishes the wizard', () => {
    const s = skipOnboarding(start());
    expect(s.onboarding).toEqual({ done: true, answers: null });
    expect(task(s, 'nozzle:extruder').intervals).toEqual({ filamentKm: 10 });
  });
});

describe('notifications', () => {
  it('stays quiet until the wizard is done and when notifications are off', () => {
    const s = createDefaultState(['extruder'], totals(), T0);
    const evals = evaluateAll(s, totals(), ZERO_TOTALS, T0 + 100 * DAY);
    expect(planNotifications(s, evals, T0, 'start').items).toEqual([]);
    const off = { ...fresh(), settings: { notifications: false, guard: true } };
    expect(planNotifications(off, evaluateAll(off, totals(), ZERO_TOTALS, T0 + 100 * DAY), T0, 'start').items).toEqual([]);
  });

  it('says "soon" once, then "overdue" once', () => {
    let s = fresh();
    const now1 = T0 + 6.5 * DAY;
    let plan = planNotifications(s, evaluateAll(s, totals(), ZERO_TOTALS, now1), now1, 'start');
    expect(plan.items.filter((i) => i.taskId === 'bed-wash')).toEqual([{ taskId: 'bed-wash', level: 'soon' }]);
    s = plan.state;

    plan = planNotifications(s, evaluateAll(s, totals(), ZERO_TOTALS, now1), now1 + 1000, 'timer');
    expect(plan.items.filter((i) => i.taskId === 'bed-wash')).toEqual([]);

    const now2 = T0 + 8 * DAY;
    plan = planNotifications(s, evaluateAll(s, totals(), ZERO_TOTALS, now2), now2, 'timer');
    expect(plan.items.filter((i) => i.taskId === 'bed-wash')).toEqual([{ taskId: 'bed-wash', level: 'overdue' }]);
    s = plan.state;

    plan = planNotifications(s, evaluateAll(s, totals(), ZERO_TOTALS, now2), now2 + 60_000, 'timer');
    expect(plan.items.filter((i) => i.taskId === 'bed-wash')).toEqual([]);
  });

  it('repeats an overdue reminder after a finished print, at most once a day', () => {
    let s = fresh();
    const now = T0 + 10 * DAY;
    s = planNotifications(s, evaluateAll(s, totals(), ZERO_TOTALS, now), now, 'start').state;
    const evals = (n: number) => evaluateAll(s, totals(), ZERO_TOTALS, n);
    expect(planNotifications(s, evals(now + 3600_000), now + 3600_000, 'printEnd').items.filter((i) => i.taskId === 'bed-wash')).toEqual([]);
    expect(planNotifications(s, evals(now + DAY), now + DAY, 'printEnd').items.filter((i) => i.taskId === 'bed-wash')).toHaveLength(1);
    expect(planNotifications(s, evals(now + DAY), now + DAY, 'timer').items.filter((i) => i.taskId === 'bed-wash')).toEqual([]);
  });

  it('forgets the reminder when the task is done, so the next cycle notifies again', () => {
    let s = fresh();
    const now = T0 + 10 * DAY;
    s = planNotifications(s, evaluateAll(s, totals(), ZERO_TOTALS, now), now, 'start').state;
    expect(task(s, 'bed-wash').notified).not.toBeNull();
    s = applyOutcome(s, 'bed-wash', 'done', totals(), now, { entryId: 'x', taskLabel: 'x' })!.state;
    expect(task(s, 'bed-wash').notified).toBeNull();
    const later = now + 8 * DAY;
    const plan = planNotifications(s, evaluateAll(s, totals(), ZERO_TOTALS, later), later, 'timer');
    expect(plan.items.filter((i) => i.taskId === 'bed-wash')).toEqual([{ taskId: 'bed-wash', level: 'overdue' }]);
  });

  it('notifies once about an activated follow-up', () => {
    let s = applyOutcome(fresh(), 'belts', 'adjusted', totals(), T0, { entryId: 'x', taskLabel: 'x' })!.state;
    const plan = planNotifications(s, evaluateAll(s, totals(), ZERO_TOTALS, T0), T0, 'history');
    expect(plan.items).toEqual([{ taskId: 'shaper-calib', level: 'overdue' }]);
    s = plan.state;
    expect(planNotifications(s, evaluateAll(s, totals(), ZERO_TOTALS, T0), T0 + 1, 'history').items).toEqual([]);
  });

  it('skips a task whose own notifications are off', () => {
    let s = fresh();
    s = { ...s, tasks: s.tasks.map((t) => (t.id === 'bed-wash' ? { ...t, notify: false } : t)) };
    const now = T0 + 10 * DAY;
    expect(planNotifications(s, evaluateAll(s, totals(), ZERO_TOTALS, now), now, 'start').items.some((i) => i.taskId === 'bed-wash')).toBe(false);
  });
});

describe('pre-print guard', () => {
  const evals = (s: MaintenanceState, now: number) => evaluateAll(s, totals(), ZERO_TOTALS, now);

  it('allows when there is no data, the wizard is unfinished or the guard is off', () => {
    expect(decideGuard(null, null)).toEqual({ action: 'allow' });
    const raw = createDefaultState(['extruder'], totals(), T0);
    expect(decideGuard(raw, evals(raw, T0 + 100 * DAY))).toEqual({ action: 'allow' });
    const off = { ...fresh(), settings: { notifications: true, guard: false } };
    expect(decideGuard(off, evals(off, T0 + 100 * DAY))).toEqual({ action: 'allow' });
  });

  it('shows the bed check even when nothing is overdue', () => {
    const s = fresh();
    expect(decideGuard(s, evals(s, T0))).toEqual({ action: 'freeze', overdue: [], bedCheck: true });
  });

  it('allows when the bed check is off and nothing is overdue', () => {
    let s = fresh();
    s = { ...s, tasks: s.tasks.map((t) => (t.kind === 'precheck' ? { ...t, enabled: false } : t)) };
    expect(decideGuard(s, evals(s, T0))).toEqual({ action: 'allow' });
  });

  it('lists the overdue tasks that take part, skipping the ones opted out', () => {
    let s = fresh();
    s = { ...s, tasks: s.tasks.map((t) => (t.id === 'belts' ? { ...t, guard: false } : t)) };
    const d = decideGuard(s, evals(s, T0 + 200 * DAY));
    expect(d.action).toBe('freeze');
    if (d.action === 'freeze') {
      expect(d.overdue).toContain('bed-wash');
      expect(d.overdue).not.toContain('belts');
    }
  });

  it('includes an activated follow-up', () => {
    const s = applyOutcome(fresh(), 'belts', 'adjusted', totals(), T0, { entryId: 'x', taskLabel: 'x' })!.state;
    const d = decideGuard(s, evals(s, T0));
    expect(d.action === 'freeze' && d.overdue).toContain('shaper-calib');
  });
});

describe('storage', () => {
  function fakeSettings() {
    const data: Record<string, unknown> = {};
    const listeners = new Set<(k: string, v: unknown) => void>();
    return {
      data,
      api: {
        get: <T,>(k: string) => data[k] as T | undefined,
        set: (k: string, v: unknown) => {
          data[k] = JSON.parse(JSON.stringify(v));
          listeners.forEach((l) => l(k, v));
        },
        onChange: (cb: (k: string, v: unknown) => void) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      },
      emit: (k: string) => listeners.forEach((l) => l(k, undefined)),
    };
  }

  it('round-trips the state and the journal per printer', () => {
    const f = fakeSettings();
    const s = fresh();
    writeState(f.api, 'p1', s);
    expect(readState(f.api, 'p1')).toEqual(s);
    expect(readState(f.api, 'p2')).toBeNull();
    writeJournal(f.api, 'p1', [{ id: '1', at: 1, taskId: 't', taskLabel: 't', outcomeId: 'done', totals: null }]);
    expect(readJournal(f.api, 'p1')).toHaveLength(1);
    expect(readJournal(f.api, 'p2')).toEqual([]);
  });

  it('rejects a foreign or newer format instead of crashing on it', () => {
    const f = fakeSettings();
    f.data[stateKey('p1')] = { v: 99, tasks: [] };
    expect(readState(f.api, 'p1')).toBeNull();
    f.data[stateKey('p1')] = 'junk';
    expect(readState(f.api, 'p1')).toBeNull();
    f.data[stateKey('p1')] = { v: 1, onboarding: {}, settings: {}, tasks: [{ id: 5 }, null] };
    expect(readState(f.api, 'p1')?.tasks).toEqual([]);
  });

  it('notifies only about this printer, and about a whole-object replacement', () => {
    const f = fakeSettings();
    let calls = 0;
    const off = watchPrinter(f.api, 'p1', () => (calls += 1));
    writeState(f.api, 'p1', fresh());
    writeState(f.api, 'p2', fresh());
    expect(calls).toBe(1);
    f.emit('');
    expect(calls).toBe(2);
    off();
    writeState(f.api, 'p1', fresh());
    expect(calls).toBe(2);
  });
});
