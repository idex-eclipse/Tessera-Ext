// @vitest-environment happy-dom
/**
 * Stage 3: the reminder monitor, the pre-print guard, its dialog and the cameras.
 * Everything runs against the real plugin module with a fake host, like host-contract.test.ts.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MaintenanceRuntime, type MoonrakerLike } from '../core/runtime';
import { resetHub } from '../hub';
import { notifyRuntime, resetMonitor, ensureMonitor } from '../monitor';
import { CANCEL_REASON, currentStart, guardPrintStart, resetQueue, resolveStart, stashApi } from '../queue';
import { parseWebcams, resolveCameraUrl } from '../ui/cameras';
import type { PluginApi } from '../sdk';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

type Dict = { [key: string]: string | Dict };
const flat = (o: Dict, prefix = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([key, v]) => (typeof v === 'string' ? [[`${prefix}${key}`, v]] : Object.entries(flat(v, `${prefix}${key}.`)))),
  );

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};

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
  };
}

interface FakeMoonraker {
  handle: MoonrakerLike & { httpBaseUrl: string };
  webcams: unknown[];
  state: { printStats?: (d: unknown) => void; history?: () => void };
}

function fakeMoonraker(webcams: unknown[] = []): FakeMoonraker {
  const state: FakeMoonraker['state'] = {};
  const m: FakeMoonraker = {
    webcams,
    state,
    handle: {
      httpBaseUrl: 'http://printer:7125',
      request: (async (method: string) => {
        if (method === 'printer.objects.list') return { objects: ['extruder'] };
        if (method === 'server.history.totals') return { job_totals: { total_jobs: 0, total_print_time: 0, total_filament_used: 0 } };
        if (method === 'server.webcams.list') return { webcams: m.webcams };
        throw new Error(method);
      }) as MoonrakerLike['request'],
      subscribe: (_o: unknown, cb: (d: unknown) => void) => {
        state.printStats = cb;
        return () => {};
      },
      onNotify: (ev: string, cb: (p: unknown) => void) => {
        if (ev === 'notify_history_changed') state.history = () => cb([]);
        return () => {};
      },
      onReady: () => () => {},
    },
  };
  return m;
}

let strings: Record<string, string>;
const printer = { id: 'p1', name: 'Voron', url: 'http://printer:7125' };

interface Harness {
  api: PluginApi;
  pushed: Array<Record<string, unknown>>;
  resumed: Array<{ token: string; decision: string; reason?: string }>;
  moon: FakeMoonraker;
  settings: ReturnType<typeof fakeSettings>;
}

function harness(webcams: unknown[] = []): Harness {
  const pushed: Harness['pushed'] = [];
  const resumed: Harness['resumed'] = [];
  const moon = fakeMoonraker(webcams);
  const settings = fakeSettings();
  const api = {
    pluginId: 'tessera/maintenance',
    printer,
    printers: [printer],
    moonrakerFor: () => moon.handle,
    settingsFor: () => settings.api,
    onPrintersChange: () => () => {},
    onPrinterChange: () => () => {},
    onLocaleChange: () => () => {},
    onThemeChange: () => () => {},
    notifications: { push: (n: Record<string, unknown>) => pushed.push(n) },
    guards: { resume: (token: string, decision: string, reason?: string) => resumed.push({ token, decision, reason }) },
    i18n: {
      locale: 'en',
      t: (key: string, params?: Record<string, string | number>) =>
        (strings[key] ?? key).replace(/\{(\w+)\}/g, (_m, n: string) => String(params?.[n] ?? '')),
    },
  } as unknown as PluginApi;
  return { api, pushed, resumed, moon, settings };
}

/** A started runtime with a finished wizard, like the one the monitor and the guard see. */
async function readyRuntime(h: Harness, now = { t: T0 }): Promise<MaintenanceRuntime> {
  const rt = new MaintenanceRuntime({
    printerId: 'p1',
    settings: h.settings.api,
    moonraker: h.moon.handle,
    now: () => now.t,
    genId: () => 'id',
    tickMs: 0,
  });
  rt.start();
  await flush();
  rt.skipWizard();
  return rt;
}

beforeAll(async () => {
  const mod = await import('../index');
  strings = flat(mod.locales.en as Dict);
});

beforeEach(() => {
  resetQueue();
  resetMonitor();
  resetHub();
});
afterEach(() => {
  resetQueue();
  resetMonitor();
  resetHub();
});

describe('reminder monitor', () => {
  it('sends nothing while nothing is due', async () => {
    const h = harness();
    const rt = await readyRuntime(h);
    notifyRuntime(h.api, rt, 'timer', T0 + DAY);
    expect(h.pushed).toHaveLength(0);
  });

  it('sends a translated notification with the printer id and a severity per level', async () => {
    const h = harness();
    const clock = { t: T0 };
    const rt = await readyRuntime(h, clock);
    clock.t = T0 + 8 * DAY; // bed wash is overdue now
    rt.reevaluate();
    notifyRuntime(h.api, rt, 'timer', clock.t);

    const wash = h.pushed.find((n) => String(n.text).includes(strings['maintenance.task.bed-wash.name']!));
    expect(wash).toBeDefined();
    expect(wash).toMatchObject({ severity: 'error', printerId: 'p1', label: strings['maintenance.notify.label'] });
    expect(String(wash!.text)).toContain('is due');

    // the same state again: nothing new, the "already told" mark was saved
    const before = h.pushed.length;
    notifyRuntime(h.api, rt, 'timer', clock.t + 1000);
    expect(h.pushed).toHaveLength(before);
  });

  it('is silent until the wizard is finished', async () => {
    const h = harness();
    const clock = { t: T0 };
    const rt = new MaintenanceRuntime({ printerId: 'p1', settings: h.settings.api, moonraker: h.moon.handle, now: () => clock.t, tickMs: 0 });
    rt.start();
    await flush();
    clock.t = T0 + 100 * DAY;
    rt.reevaluate();
    notifyRuntime(h.api, rt, 'start', clock.t);
    expect(h.pushed).toEqual([]);
  });

  it('reacts to the runtime events: start, history, a finished print', async () => {
    const h = harness();
    const clock = { t: T0 };
    ensureMonitor(h.api);
    await flush();
    // the monitor attached its own runtime for p1 through the hub; finish its wizard
    const { peekRuntime } = await import('../hub');
    const rt = peekRuntime('p1')!;
    expect(rt).toBeDefined();
    rt.skipWizard();
    void clock;
    // a finished print triggers an evaluation (nothing overdue yet, so nothing is sent)
    h.moon.state.printStats?.({ print_stats: { state: 'printing', print_duration: 10, filament_used: 1 } });
    h.moon.state.printStats?.({ print_stats: { state: 'complete' } });
    await flush();
    expect(h.pushed).toEqual([]);
  });
});

describe('pre-print guard', () => {
  it('lets the print through when no overlay is mounted (nobody could resume it)', async () => {
    const h = harness();
    await readyRuntime(h);
    expect(guardPrintStart({ method: 'printer.print.start' }, 't1', { targetPrinterId: 'p1' })).toEqual({ action: 'allow' });
  });

  it('lets the print through for a printer it knows nothing about', () => {
    const h = harness();
    stashApi(h.api);
    expect(guardPrintStart({ method: 'printer.print.start' }, 't1', { targetPrinterId: 'unknown' })).toEqual({ action: 'allow' });
  });

  async function guardedHarness() {
    const h = harness();
    ensureMonitor(h.api); // registers the runtime in the hub, like the overlay does
    await flush();
    const { peekRuntime } = await import('../hub');
    const rt = peekRuntime('p1')!;
    stashApi(h.api);
    return { h, rt };
  }

  it('freezes with the bed check and lists the overdue tasks', async () => {
    const { rt } = await guardedHarness();
    rt.skipWizard();
    const d = guardPrintStart({ method: 'printer.print.start', params: { filename: 'cube.gcode' } }, 'tok1', { targetPrinterId: 'p1' });
    expect(d).toEqual({ action: 'freeze' });
    expect(currentStart()).toMatchObject({ token: 'tok1', printerId: 'p1', filename: 'cube.gcode', bedCheck: true });
  });

  it('does not freeze while the wizard is not finished', async () => {
    await guardedHarness();
    expect(guardPrintStart({ method: 'printer.print.start' }, 'tok', { targetPrinterId: 'p1' })).toEqual({ action: 'allow' });
  });

  it('resumes with accept or with deny and the reason key, one dialog at a time', async () => {
    const { h, rt } = await guardedHarness();
    rt.skipWizard();
    guardPrintStart({ method: 'printer.print.start' }, 'a', { targetPrinterId: 'p1' });
    guardPrintStart({ method: 'server.job_queue.start' }, 'b', { targetPrinterId: 'p1' });
    expect(currentStart()?.token).toBe('a');
    resolveStart(true);
    expect(currentStart()?.token).toBe('b');
    resolveStart(false);
    expect(currentStart()).toBeNull();
    expect(h.resumed).toEqual([
      { token: 'a', decision: 'accept', reason: undefined },
      { token: 'b', decision: 'deny', reason: CANCEL_REASON },
    ]);
    expect(strings[CANCEL_REASON]).toBeTruthy();
  });

  it('never throws: a broken runtime lets the print through', async () => {
    const { rt } = await guardedHarness();
    rt.skipWizard();
    vi.spyOn(rt, 'reevaluate').mockImplementation(() => {
      throw new Error('boom');
    });
    expect(guardPrintStart({ method: 'printer.print.start' }, 'x', { targetPrinterId: 'p1' })).toEqual({ action: 'allow' });
  });
});

describe('the dialog (overlay element)', () => {
  type El = HTMLElement & { api: PluginApi; params: unknown; updateComplete: Promise<boolean> };

  async function mountOverlay(h: Harness): Promise<El> {
    const el = document.createElement('tessera-maintenance-overlay') as El;
    el.api = h.api;
    el.params = {};
    document.body.append(el);
    await flush();
    return el;
  }

  const buttons = (el: El): HTMLButtonElement[] => [...(el.shadowRoot?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];

  it('renders nothing while no print is waiting (overlays sit on a pointer-events layer)', async () => {
    const h = harness();
    const el = await mountOverlay(h);
    expect(el.shadowRoot?.querySelector('.backdrop')).toBeNull();
    el.remove();
  });

  it('shows the bed check, keeps Start disabled until it is confirmed, then resumes with accept', async () => {
    const h = harness([{ name: 'cam', service: 'mjpegstreamer', snapshot_url: '/webcam/?action=snapshot' }]);
    const el = await mountOverlay(h); // starts the monitor and stashes the api
    const { peekRuntime } = await import('../hub');
    peekRuntime('p1')!.skipWizard();

    expect(guardPrintStart({ method: 'printer.print.start', params: { filename: 'cube.gcode' } }, 'tok', { targetPrinterId: 'p1' })).toEqual({ action: 'freeze' });
    await flush();
    await el.updateComplete;

    const start = buttons(el).find((b) => b.textContent?.trim() === strings['maintenance.guard.start'])!;
    expect(start).toBeDefined();
    expect(start.disabled).toBe(true);
    expect(el.shadowRoot?.querySelector('tessera-maint-cameras')).not.toBeNull();

    const box = el.shadowRoot!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(buttons(el).find((b) => b.textContent?.trim() === strings['maintenance.guard.start'])!.disabled).toBe(false);

    buttons(el).find((b) => b.textContent?.trim() === strings['maintenance.guard.start'])!.click();
    await el.updateComplete;
    expect(h.resumed).toEqual([{ token: 'tok', decision: 'accept', reason: undefined }]);
    expect(el.shadowRoot?.querySelector('.backdrop')).toBeNull();
    el.remove();
  });

  it('Cancel and Escape deny the print with the reason key', async () => {
    const h = harness();
    const el = await mountOverlay(h);
    const { peekRuntime } = await import('../hub');
    peekRuntime('p1')!.skipWizard();

    guardPrintStart({ method: 'printer.print.start' }, 'c1', { targetPrinterId: 'p1' });
    await flush();
    await el.updateComplete;
    buttons(el).find((b) => b.textContent?.trim() === strings['maintenance.common.cancel'])!.click();
    expect(h.resumed.at(-1)).toEqual({ token: 'c1', decision: 'deny', reason: CANCEL_REASON });

    guardPrintStart({ method: 'printer.print.start' }, 'c2', { targetPrinterId: 'p1' });
    await flush();
    await el.updateComplete;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(h.resumed.at(-1)).toEqual({ token: 'c2', decision: 'deny', reason: CANCEL_REASON });
    el.remove();
  });

  it('with overdue work the primary button says "Start anyway" and the start is logged', async () => {
    const h = harness();
    const el = await mountOverlay(h);
    const { peekRuntime } = await import('../hub');
    const rt = peekRuntime('p1')!;
    rt.skipWizard();
    // bed check off, so the confirmation is not needed, and a task made overdue by a link
    rt.mutate((s) => ({ ...s, tasks: s.tasks.map((t) => (t.kind === 'precheck' ? { ...t, enabled: false } : t)) }));
    rt.press('belts', 'adjusted', undefined, 'Belts'); // activates the shaper calibration
    guardPrintStart({ method: 'printer.print.start' }, 'tok', { targetPrinterId: 'p1' });
    await flush();
    await el.updateComplete;

    const anyway = buttons(el).find((b) => b.textContent?.trim() === strings['maintenance.guard.startAnyway'])!;
    expect(anyway).toBeDefined();
    expect(anyway.disabled).toBe(false);
    expect(el.shadowRoot!.querySelector('tessera-maint-cameras')).toBeNull();
    anyway.click();
    expect(h.resumed.at(-1)).toMatchObject({ token: 'tok', decision: 'accept' });
    expect(rt.journal[0]).toMatchObject({ outcomeId: 'startedAnyway' });
    expect(rt.journal[0]!.taskLabel).toContain(strings['maintenance.task.shaper-calib.name']!);
    el.remove();
  });
});

describe('cameras', () => {
  it('keeps enabled cameras and applies the widget defaults', () => {
    const list = parseWebcams({
      webcams: [
        { name: 'a', service: 'mjpegstreamer', snapshot_url: '/snap', rotation: 90, flip_horizontal: true },
        { name: 'off', enabled: false },
        { name: 'b' },
        { service: 'no-name' },
      ],
    });
    expect(list.map((c) => c.name)).toEqual(['a', 'b']);
    expect(list[0]).toMatchObject({ snapshotUrl: '/snap', rotation: 90, flipH: true });
    expect(list[1]!.snapshotUrl).toBe('/webcam/?action=snapshot');
    expect(parseWebcams(null)).toEqual([]);
  });

  it('resolves relative URLs against the web server without the Moonraker port', () => {
    expect(resolveCameraUrl('/webcam/?action=snapshot', 'http://printer:7125')).toBe('http://printer/webcam/?action=snapshot');
    expect(resolveCameraUrl('webcam/x', 'http://printer:7125')).toBe('http://printer/webcam/x');
    expect(resolveCameraUrl('http://cam.local/snap', 'http://printer:7125')).toBe('http://cam.local/snap');
  });

  it('requests a snapshot per camera and notes a missing camera list', async () => {
    const h = harness([{ name: 'cam', snapshot_url: '/webcam/?action=snapshot' }]);
    const el = document.createElement('tessera-maint-cameras') as HTMLElement & { api: PluginApi; printerId: string; updateComplete: Promise<boolean> };
    el.api = h.api;
    el.printerId = 'p1';
    document.body.append(el);
    await flush();
    await el.updateComplete;
    const img = el.shadowRoot!.querySelector('img')!;
    expect(img.getAttribute('src')).toMatch(/^http:\/\/printer\/webcam\/\?action=snapshot&_cb=\d+$/);
    el.remove();

    const none = harness([]);
    const el2 = document.createElement('tessera-maint-cameras') as typeof el;
    el2.api = none.api;
    el2.printerId = 'p1';
    document.body.append(el2);
    await flush();
    await el2.updateComplete;
    expect(el2.shadowRoot!.textContent).toContain(strings['maintenance.guard.noCamera']);
    el2.remove();
  });
});
