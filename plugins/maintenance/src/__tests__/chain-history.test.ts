// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';

import { applySnapshot, ChainHistory, HISTORY_LIMIT, snapshotOf } from '../core/chain-history';
import { edgesOf } from '../core/chains';
import { createDefaultState } from '../core/defaults';
import { MaintenanceRuntime, type MoonrakerLike } from '../core/runtime';
import type { MaintenanceState } from '../core/types';
import type { PluginApi } from '../sdk';

const T0 = 1_700_000_000_000;
const totals = { printSeconds: 0, jobs: 0, filamentMm: 0 };
const fresh = (): MaintenanceState => ({ ...createDefaultState(['extruder'], totals, T0), onboarding: { done: true, answers: null } });

describe('chain history (pure)', () => {
  it('records a change, undoes it and redoes it', () => {
    const h = new ChainHistory();
    let s = fresh();
    h.reset(s);
    expect(h.canUndo).toBe(false);

    const next: MaintenanceState = { ...s, layout: { belts: { x: 1, y: 2 } } };
    expect(h.changed(next)).toBe(true);
    s = next;
    expect(h.canUndo).toBe(true);

    const back = h.undo()!;
    expect(back.layout).toBeUndefined();
    expect(h.canRedo).toBe(true);
    s = applySnapshot(s, back);
    expect(s.layout).toBeUndefined();
    // the state produced by the undo itself is not a new step
    expect(h.changed(s)).toBe(false);

    const again = h.redo()!;
    expect(again.layout).toEqual({ belts: { x: 1, y: 2 } });
    expect(h.canRedo).toBe(false);
  });

  it('a new change after an undo clears the redo stack', () => {
    const h = new ChainHistory();
    const s0 = fresh();
    h.reset(s0);
    const s1 = { ...s0, layout: { a: { x: 1, y: 1 } } };
    h.changed(s1);
    h.undo();
    expect(h.canRedo).toBe(true);
    h.changed({ ...s0, layout: { b: { x: 2, y: 2 } } });
    expect(h.canRedo).toBe(false);
  });

  it('ignores changes that are not links or positions', () => {
    const h = new ChainHistory();
    const s = fresh();
    h.reset(s);
    const pressed = { ...s, tasks: s.tasks.map((t) => (t.id === 'bed-wash' ? { ...t, lastDone: 5, intervals: { days: 3 } } : t)) };
    expect(h.changed(pressed)).toBe(false);
    expect(h.canUndo).toBe(false);
  });

  it('keeps at most HISTORY_LIMIT steps', () => {
    const h = new ChainHistory();
    const s = fresh();
    h.reset(s);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i += 1) h.changed({ ...s, layout: { a: { x: i, y: 0 } } });
    let undone = 0;
    while (h.undo()) undone += 1;
    expect(undone).toBe(HISTORY_LIMIT);
  });

  it('a snapshot restores links without touching anything else, and drops links to deleted tasks', () => {
    const s = fresh();
    const snap = snapshotOf(s);
    const edited: MaintenanceState = {
      ...s,
      tasks: s.tasks.map((t) =>
        t.id === 'belts' ? { ...t, lastDone: 99, outcomes: t.outcomes.map((o) => ({ ...o, activates: [] })) } : t,
      ),
    };
    const restored = applySnapshot(edited, snap);
    const belts = restored.tasks.find((t) => t.id === 'belts')!;
    expect(belts.outcomes[1]!.activates).toEqual(['shaper-calib']);
    expect(belts.lastDone).toBe(99); // not part of the snapshot, so not rolled back

    const withoutShaper = { ...restored, tasks: restored.tasks.filter((t) => t.id !== 'shaper-calib') };
    const again = applySnapshot(withoutShaper, snap);
    expect(again.tasks.find((t) => t.id === 'belts')!.outcomes[1]!.activates).toEqual([]);
  });
});

describe('chain editor: undo and redo', () => {
  type El = HTMLElement & { api: PluginApi; runtime: MaintenanceRuntime; updateComplete: Promise<boolean> };
  let strings: Record<string, string>;

  beforeAll(async () => {
    const mod = await import('../index');
    const flat = (o: Record<string, unknown>, prefix = ''): Record<string, string> =>
      Object.fromEntries(
        Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v]] : Object.entries(flat(v as Record<string, unknown>, `${prefix}${k}.`)))),
      );
    strings = flat(mod.locales.en as Record<string, unknown>);
  });

  async function setup(): Promise<{ el: El; rt: MaintenanceRuntime }> {
    const data: Record<string, unknown> = {};
    const moon: MoonrakerLike = {
      request: (async (m: string) =>
        m === 'server.history.totals' ? { job_totals: { total_jobs: 0, total_print_time: 0, total_filament_used: 0 } } : { objects: ['extruder'] }) as MoonrakerLike['request'],
      subscribe: () => () => {},
      onNotify: () => () => {},
      onReady: () => () => {},
    };
    const rt = new MaintenanceRuntime({
      printerId: 'p1',
      settings: { get: <T,>(k: string) => data[k] as T | undefined, set: (k, v) => void (data[k] = JSON.parse(JSON.stringify(v))), onChange: () => () => {} },
      moonraker: moon,
      tickMs: 0,
    });
    rt.start();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    rt.skipWizard();
    const api = {
      printer: { id: 'p1' },
      onLocaleChange: () => () => {},
      i18n: { locale: 'en', t: (key: string, params?: Record<string, string | number>) => (strings[key] ?? key).replace(/\{(\w+)\}/g, (_m, n: string) => String(params?.[n] ?? '')) },
    } as unknown as PluginApi;
    const el = document.createElement('tessera-maint-chains') as El;
    el.api = api;
    el.runtime = rt;
    document.body.append(el);
    await el.updateComplete;
    return { el, rt };
  }

  const key = (init: KeyboardEventInit): KeyboardEvent => new KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init });
  /** Undo and redo are icon buttons: found by their accessible name. */
  const button = (el: El, label: string): HTMLButtonElement =>
    [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.panel-meta button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label)!;

  it('starts with nothing to undo, then Ctrl+Z undoes a link and Ctrl+Y brings it back', async () => {
    const { el, rt } = await setup();
    const before = edgesOf(rt.state!).length;
    expect(button(el, strings['maintenance.chains.undo']!).disabled).toBe(true);
    expect(button(el, strings['maintenance.chains.redo']!).disabled).toBe(true);

    rt.linkOutcome('bed-wash', 'done', 'lube-axes');
    await el.updateComplete;
    expect(edgesOf(rt.state!)).toHaveLength(before + 1);
    expect(button(el, strings['maintenance.chains.undo']!).disabled).toBe(false);

    const z = key({ key: 'z', ctrlKey: true });
    window.dispatchEvent(z);
    await el.updateComplete;
    expect(z.defaultPrevented).toBe(true);
    expect(edgesOf(rt.state!)).toHaveLength(before);
    expect(button(el, strings['maintenance.chains.redo']!).disabled).toBe(false);
    expect(button(el, strings['maintenance.chains.undo']!).disabled).toBe(true);

    window.dispatchEvent(key({ key: 'y', ctrlKey: true }));
    await el.updateComplete;
    expect(edgesOf(rt.state!)).toHaveLength(before + 1);
    el.remove();
  });

  it('works on a Russian keyboard layout: the physical key counts, not the typed letter', async () => {
    const { el, rt } = await setup();
    rt.linkOutcome('bed-wash', 'done', 'lube-axes');
    await el.updateComplete;
    // Ctrl+Z on a Russian layout types "я" but the physical key is still KeyZ
    const undo = key({ key: 'я', code: 'KeyZ', ctrlKey: true });
    window.dispatchEvent(undo);
    await el.updateComplete;
    expect(undo.defaultPrevented).toBe(true);
    expect(edgesOf(rt.state!).some((e) => e.from === 'bed-wash')).toBe(false);
    window.dispatchEvent(key({ key: 'н', code: 'KeyY', ctrlKey: true }));
    await el.updateComplete;
    expect(edgesOf(rt.state!).some((e) => e.from === 'bed-wash')).toBe(true);
    el.remove();
  });

  it('Ctrl+Shift+Z and Cmd work like Ctrl+Y and Ctrl+Z', async () => {
    const { el, rt } = await setup();
    rt.linkOutcome('bed-wash', 'done', 'lube-axes');
    window.dispatchEvent(key({ key: 'z', metaKey: true }));
    await el.updateComplete;
    expect(edgesOf(rt.state!).some((e) => e.from === 'bed-wash')).toBe(false);
    window.dispatchEvent(key({ key: 'Z', ctrlKey: true, shiftKey: true }));
    await el.updateComplete;
    expect(edgesOf(rt.state!).some((e) => e.from === 'bed-wash')).toBe(true);
    el.remove();
  });

  it('undoes a removed link and a moved card, step by step', async () => {
    const { el, rt } = await setup();
    const before = edgesOf(rt.state!).length;
    rt.unlinkOutcome({ from: 'belts', outcome: 'adjusted', to: 'shaper-calib' });
    rt.setLayout({ belts: { x: 5, y: 6 } });
    await el.updateComplete;
    expect(edgesOf(rt.state!)).toHaveLength(before - 1);

    button(el, strings['maintenance.chains.undo']!).click(); // the move
    await el.updateComplete;
    expect(rt.state!.layout).toBeUndefined();
    expect(edgesOf(rt.state!)).toHaveLength(before - 1);

    button(el, strings['maintenance.chains.undo']!).click(); // the removal
    await el.updateComplete;
    expect(edgesOf(rt.state!)).toHaveLength(before);
    el.remove();
  });

  it('leaves the shortcut alone inside text fields and while a dialog is open', async () => {
    const { el, rt } = await setup();
    rt.linkOutcome('bed-wash', 'done', 'lube-axes');
    await el.updateComplete;
    const count = edgesOf(rt.state!).length;

    const input = document.createElement('input');
    document.body.append(input);
    const inField = key({ key: 'z', ctrlKey: true });
    input.dispatchEvent(inField);
    expect(inField.defaultPrevented).toBe(false);
    expect(edgesOf(rt.state!)).toHaveLength(count);
    input.remove();

    const dialog = document.createElement('dialog');
    document.body.append(dialog);
    const inDialog = key({ key: 'z', ctrlKey: true });
    dialog.dispatchEvent(inDialog);
    expect(inDialog.defaultPrevented).toBe(false);
    expect(edgesOf(rt.state!)).toHaveLength(count);
    dialog.remove();
    el.remove();
  });

  it('a button press on a card is not an undo step', async () => {
    const { el, rt } = await setup();
    rt.press('belts', 'adjusted', undefined, 'Belts');
    await el.updateComplete;
    expect(button(el, strings['maintenance.chains.undo']!).disabled).toBe(true);
    el.remove();
  });

  it('stops listening when the editor is removed', async () => {
    const { el, rt } = await setup();
    rt.linkOutcome('bed-wash', 'done', 'lube-axes');
    el.remove();
    const z = key({ key: 'z', ctrlKey: true });
    window.dispatchEvent(z);
    expect(z.defaultPrevented).toBe(false);
    expect(edgesOf(rt.state!).some((e) => e.from === 'bed-wash')).toBe(true);
  });
});
