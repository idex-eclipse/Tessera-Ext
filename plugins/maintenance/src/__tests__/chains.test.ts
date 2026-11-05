// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';

import { addLink, autoLayout, boardSize, chainTasks, edgeKey, edgePath, edgesOf, GAP_X, NODE_W, removeLink } from '../core/chains';
import { createDefaultState, newCustomTask } from '../core/defaults';
import { validateGraph } from '../core/graph';
import { MaintenanceRuntime, type MoonrakerLike } from '../core/runtime';
import type { PluginApi } from '../sdk';
import type { MaintenanceState, Task } from '../core/types';

const T0 = 1_700_000_000_000;
const totals = { printSeconds: 0, jobs: 0, filamentMm: 0 };
const fresh = (): MaintenanceState => ({ ...createDefaultState(['extruder'], totals, T0), onboarding: { done: true, answers: null } });
const task = (s: MaintenanceState, id: string): Task => s.tasks.find((t) => t.id === id)!;

describe('edges and layout', () => {
  it('lists the built-in chains and leaves the bed check out', () => {
    const s = fresh();
    expect(chainTasks(s).some((t) => t.kind === 'precheck')).toBe(false);
    const keys = edgesOf(s).map(edgeKey);
    expect(keys).toContain('belts|adjusted|shaper-calib');
    expect(keys).toContain('nozzle:extruder|replaced|zoffset:extruder');
    expect(keys).toContain('nozzle:extruder|replaced|hot-tighten:extruder');
    expect(edgesOf(s)).toHaveLength(3);
  });

  it('drops links to tasks that no longer exist', () => {
    const s = fresh();
    const t = { ...s, tasks: s.tasks.map((x) => (x.id === 'belts' ? { ...x, outcomes: [{ ...x.outcomes[0]!, activates: ['ghost'] }] } : x)) };
    expect(edgesOf(t).some((e) => e.to === 'ghost')).toBe(false);
  });

  it('puts a chain in columns from its start to its end', () => {
    const pos = autoLayout(fresh());
    const col = (id: string): number => Math.round((pos[id]!.x - GAP_X / 2) / (NODE_W + GAP_X));
    expect(col('belts')).toBe(0);
    expect(col('shaper-calib')).toBe(1);
    expect(col('nozzle:extruder')).toBe(0);
    expect(col('zoffset:extruder')).toBe(1);
    expect(col('hot-tighten:extruder')).toBe(1);
    // cards of one column never overlap
    const column1 = ['shaper-calib', 'zoffset:extruder', 'hot-tighten:extruder'].map((id) => pos[id]!.y).sort((a, b) => a - b);
    expect(new Set(column1).size).toBe(3);
  });

  it('lays out a cycle without looping forever', () => {
    const s = fresh();
    const tasks = s.tasks.map((t): Task => {
      if (t.id === 'shaper-calib') return { ...t, outcomes: [{ ...t.outcomes[0]!, activates: ['hot-tighten:extruder'] }] };
      if (t.id === 'hot-tighten:extruder') return { ...t, outcomes: [{ ...t.outcomes[0]!, activates: ['shaper-calib', 'hot-tighten:extruder'] }] };
      return t;
    });
    const pos = autoLayout({ tasks });
    expect(Object.keys(pos)).toHaveLength(chainTasks({ tasks }).length);
  });

  it('sizes the board to hold every card', () => {
    const s = fresh();
    const pos = autoLayout(s);
    const size = boardSize(chainTasks(s), pos);
    for (const t of chainTasks(s)) expect(pos[t.id]!.x + NODE_W).toBeLessThanOrEqual(size.w);
    expect(size.h).toBeGreaterThan(0);
  });

  it('mirrors a line for right-to-left text', () => {
    const ltr = edgePath({ x: 0, y: 0 }, { x: 200, y: 50 }, 1);
    const rtl = edgePath({ x: 200, y: 0 }, { x: 0, y: 50 }, -1);
    expect(ltr).toBe('M 0 0 C 100 0, 100 50, 200 50');
    expect(rtl).toBe('M 200 0 C 100 0, 100 50, 0 50');
  });
});

describe('adding and removing links', () => {
  it('links a result to any task, including a timer task and itself', () => {
    let s = fresh();
    const toTimer = addLink(s, 'bed-wash', 'done', 'lube-axes');
    expect('state' in toTimer).toBe(true);
    s = (toTimer as { state: MaintenanceState }).state;
    expect(task(s, 'bed-wash').outcomes[0]!.activates).toEqual(['lube-axes']);
    const self = addLink(s, 'bed-wash', 'done', 'bed-wash');
    expect('state' in self).toBe(true);
  });

  it('refuses unknown cards, the bed check, unknown results and duplicates', () => {
    const s = fresh();
    expect(addLink(s, 'ghost', 'done', 'belts')).toEqual({ error: 'unknown-task' });
    expect(addLink(s, 'bed-check', 'done', 'belts')).toEqual({ error: 'unknown-task' });
    expect(addLink(s, 'belts', 'checked', 'bed-check')).toEqual({ error: 'bad-target' });
    expect(addLink(s, 'belts', 'nope', 'bed-wash')).toEqual({ error: 'unknown-outcome' });
    expect(addLink(s, 'belts', 'adjusted', 'shaper-calib')).toEqual({ error: 'duplicate' });
    expect(addLink(s, 'belts', 'checked', 'ghost')).toEqual({ error: 'bad-target' });
  });

  it('removes a link and leaves the state alone when there was none', () => {
    const s = fresh();
    const gone = removeLink(s, { from: 'belts', outcome: 'adjusted', to: 'shaper-calib' });
    expect(task(gone, 'belts').outcomes[1]!.activates).toEqual([]);
    expect(removeLink(gone, { from: 'belts', outcome: 'adjusted', to: 'shaper-calib' })).toBe(gone);
  });

  it('a link made in the editor is a valid graph; a circle is only a warning', () => {
    let s = fresh();
    const a = newCustomTask('custom:a', 'A', 'interval', totals, T0);
    const b = newCustomTask('custom:b', 'B', 'interval', totals, T0);
    s = { ...s, tasks: [...s.tasks, a, b] };
    s = (addLink(s, 'custom:a', 'done', 'custom:b') as { state: MaintenanceState }).state;
    expect(validateGraph(s)).toEqual([]);
    s = (addLink(s, 'custom:b', 'done', 'custom:a') as { state: MaintenanceState }).state;
    expect(validateGraph(s).map((i) => i.severity)).toEqual(['warning']);
  });
});

describe('runtime link and layout actions', () => {
  function fakeSettings() {
    const data: Record<string, unknown> = {};
    return {
      get: <T,>(k: string) => data[k] as T | undefined,
      set: (k: string, v: unknown) => void (data[k] = JSON.parse(JSON.stringify(v))),
      onChange: () => () => {},
    };
  }
  const moon: MoonrakerLike = {
    request: (async (m: string) =>
      m === 'server.history.totals' ? { job_totals: { total_jobs: 0, total_print_time: 0, total_filament_used: 0 } } : { objects: ['extruder'] }) as MoonrakerLike['request'],
    subscribe: () => () => {},
    onNotify: () => () => {},
    onReady: () => () => {},
  };
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };

  it('saves links and positions, and forgets the positions on request', async () => {
    const rt = new MaintenanceRuntime({ printerId: 'p1', settings: fakeSettings(), moonraker: moon, tickMs: 0 });
    rt.start();
    await flush();
    expect(rt.linkOutcome('bed-wash', 'done', 'lube-axes')).toBeNull();
    expect(rt.linkOutcome('bed-wash', 'done', 'lube-axes')).toBe('duplicate');
    expect(rt.state!.tasks.find((t) => t.id === 'bed-wash')!.outcomes[0]!.activates).toEqual(['lube-axes']);
    // a link edit does not pin the card: the wizard may still set its interval
    expect(rt.state!.tasks.find((t) => t.id === 'bed-wash')!.customized).toBe(false);

    rt.unlinkOutcome({ from: 'bed-wash', outcome: 'done', to: 'lube-axes' });
    expect(rt.state!.tasks.find((t) => t.id === 'bed-wash')!.outcomes[0]!.activates).toEqual([]);

    rt.setLayout({ belts: { x: 10, y: 20 } });
    expect(rt.state!.layout).toEqual({ belts: { x: 10, y: 20 } });
    rt.setLayout(null);
    expect(rt.state!.layout).toBeUndefined();
  });
});

describe('the chain editor element', () => {
  type El = HTMLElement & { api: PluginApi; runtime: MaintenanceRuntime; updateComplete: Promise<boolean> };
  let strings: Record<string, string>;
  let rt: MaintenanceRuntime;
  let api: PluginApi;

  beforeAll(async () => {
    const mod = await import('../index');
    const flat = (o: Record<string, unknown>, prefix = ''): Record<string, string> =>
      Object.fromEntries(
        Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[`${prefix}${k}`, v]] : Object.entries(flat(v as Record<string, unknown>, `${prefix}${k}.`)))),
      );
    strings = flat(mod.locales.en as Record<string, unknown>);
    const data: Record<string, unknown> = {};
    rt = new MaintenanceRuntime({
      printerId: 'p1',
      settings: { get: <T,>(k: string) => data[k] as T | undefined, set: (k, v) => void (data[k] = JSON.parse(JSON.stringify(v))), onChange: () => () => {} },
      moonraker: {
        request: (async (m: string) =>
          m === 'server.history.totals' ? { job_totals: { total_jobs: 0, total_print_time: 0, total_filament_used: 0 } } : { objects: ['extruder'] }) as MoonrakerLike['request'],
        subscribe: () => () => {},
        onNotify: () => () => {},
        onReady: () => () => {},
      },
      tickMs: 0,
    });
    rt.start();
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    rt.skipWizard();
    api = {
      printer: { id: 'p1' },
      onLocaleChange: () => () => {},
      i18n: {
        locale: 'en',
        t: (key: string, params?: Record<string, string | number>) => (strings[key] ?? key).replace(/\{(\w+)\}/g, (_m, n: string) => String(params?.[n] ?? '')),
      },
    } as unknown as PluginApi;
  });

  async function mount(): Promise<El> {
    const el = document.createElement('tessera-maint-chains') as El;
    el.api = api;
    el.runtime = rt;
    document.body.append(el);
    await el.updateComplete;
    return el;
  }

  it('draws a card per task, a dot per result and a line per link', async () => {
    const el = await mount();
    const root = el.shadowRoot!;
    expect(root.querySelectorAll('.node')).toHaveLength(chainTasks(rt.state!).length);
    const results = chainTasks(rt.state!).reduce((n, t) => n + t.outcomes.length, 0);
    expect(root.querySelectorAll('.port.out')).toHaveLength(results);
    expect(root.querySelectorAll('.port.in')).toHaveLength(chainTasks(rt.state!).length);
    expect(root.querySelectorAll('path.line')).toHaveLength(edgesOf(rt.state!).length);
    expect(root.querySelectorAll('.port.out.linked').length).toBeGreaterThanOrEqual(2);
    el.remove();
  });

  it('adds a link from the list editor and removes one with its button', async () => {
    const el = await mount();
    const root = el.shadowRoot!;
    const before = edgesOf(rt.state!).length;

    const [from, outcome, to] = [...root.querySelectorAll<HTMLSelectElement>('.form select')];
    from!.value = 'lube-axes';
    from!.dispatchEvent(new Event('change'));
    await el.updateComplete;
    const outcome2 = root.querySelectorAll<HTMLSelectElement>('.form select')[1]!;
    expect(outcome2.options.length).toBeGreaterThan(0);
    to!.value = 'bed-wash';
    to!.dispatchEvent(new Event('change'));
    await el.updateComplete;
    void outcome;
    const add = [...root.querySelectorAll<HTMLButtonElement>('.form button')].find((b) => b.textContent?.trim() === strings['maintenance.chains.add'])!;
    expect(add.disabled).toBe(false);
    add.click();
    await el.updateComplete;
    expect(edgesOf(rt.state!)).toHaveLength(before + 1);
    expect(root.querySelectorAll('path.line')).toHaveLength(before + 1);

    // the same link again is refused with a message
    add.click();
    await el.updateComplete;
    expect(root.textContent).toContain(strings['maintenance.chains.duplicate']);

    const remove = [...root.querySelectorAll<HTMLButtonElement>('td.act button')].find(() => true)!;
    remove.click();
    await el.updateComplete;
    expect(edgesOf(rt.state!)).toHaveLength(before);
    el.remove();
  });

  it('selects a line by clicking it and removes it with the header button or Delete', async () => {
    const el = await mount();
    const root = el.shadowRoot!;
    const before = edgesOf(rt.state!).length;
    root.querySelector<SVGPathElement>('path.hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await el.updateComplete;
    const remove = [...root.querySelectorAll<HTMLButtonElement>('.panel-meta button')].find((b) => b.textContent?.trim() === strings['maintenance.chains.removeSelected'])!;
    expect(remove).toBeDefined();
    remove.click();
    await el.updateComplete;
    expect(edgesOf(rt.state!)).toHaveLength(before - 1);

    root.querySelector<SVGPathElement>('path.hit')!.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await el.updateComplete;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, composed: true }));
    await el.updateComplete;
    expect(edgesOf(rt.state!)).toHaveLength(before - 2);
    el.remove();
  });

  it('tells the tab to open the editor for a card and for a new task', async () => {
    const el = await mount();
    const seen: string[] = [];
    el.addEventListener('edit-task', (e) => seen.push(`edit:${(e as CustomEvent<{ id: string }>).detail.id}`));
    el.addEventListener('create-task', () => seen.push('create'));
    el.shadowRoot!.querySelector<HTMLButtonElement>('.node-head button')!.click();
    [...el.shadowRoot!.querySelectorAll<HTMLButtonElement>('.panel-meta button')].find((b) => b.classList.contains('primary'))!.click();
    expect(seen[0]).toMatch(/^edit:/);
    expect(seen[1]).toBe('create');
    el.remove();
  });
});
