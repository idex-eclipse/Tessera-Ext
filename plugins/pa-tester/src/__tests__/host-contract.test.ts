// @vitest-environment happy-dom
/**
 * Plays the host's role against the real plugin module:
 * - checks every tag and named export manifest.json refers to;
 * - calls `available` and the guard the way the host does;
 * - mounts the extension like PluginElementHost: createElement(tag) →
 *   el.api / el.params → append, re-assigns params, then removes it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../sdk';

// uPlot paints on a canvas, which happy-dom does not provide.
vi.mock('uplot', () => ({
  default: class {
    setData = vi.fn();
    setSize = vi.fn();
    destroy = vi.fn();
    cursor = {};
  },
}));

type Handler = (params: unknown) => unknown;

function createFakeApi(responses: Record<string, Handler>) {
  const unsubscribed = vi.fn();
  const streamUnreg = vi.fn();
  const notifyHandlers = new Map<string, (params: unknown) => void>();
  const streams: Array<{ method: string; params: unknown; onData: (d: unknown) => void; onStatus: (s: string) => void }> = [];
  const handle = {
    readyState: 'open',
    httpBaseUrl: 'http://printer',
    authToken: null,
    request: vi.fn(async (method: string, params?: unknown) => {
      const h = responses[method];
      if (!h) throw new Error(`unexpected request ${method}`);
      return h(params);
    }),
    subscribe: vi.fn((_objects: unknown, cb: (d: unknown) => void) => {
      cb({
        print_stats: { state: 'standby' },
        toolhead: { homed_axes: 'xyz', extruder: 'extruder' },
        webhooks: { state: 'ready' },
        extruder: { temperature: 210, target: 210, pressure_advance: 0.04, can_extrude: true },
      });
      return unsubscribed;
    }),
    onNotify: vi.fn((event: string, cb: (params: unknown) => void) => {
      notifyHandlers.set(event, cb);
      return unsubscribed;
    }),
    klippyStream: vi.fn((method: string, params: unknown, onData: (d: unknown) => void, onStatus: (s: string) => void) => {
      streams.push({ method, params, onData, onStatus });
      onStatus('connecting');
      return streamUnreg;
    }),
    onReady: vi.fn(() => () => {}),
    onConnectionStatusChange: vi.fn(() => () => {}),
    poll: vi.fn(() => () => {}),
  };
  const printer = { id: 'p1', name: 'Voron', url: 'http://printer' };
  const store: Record<string, unknown> = {};
  const api = {
    pluginId: 'tessera/pa-tester',
    printer,
    printers: [printer],
    moonraker: () => handle,
    moonrakerFor: () => handle,
    onPrinterChange: () => unsubscribed,
    onPrintersChange: () => () => {},
    onLocaleChange: () => unsubscribed,
    onThemeChange: () => unsubscribed,
    i18n: { locale: 'en', t: (key: string) => key },
    settings: { get: (k: string) => store[k], set: (k: string, v: unknown) => (store[k] = v), onChange: () => () => {} },
    guards: { resume: vi.fn() },
  } as unknown as PluginApi;
  return { api, handle, unsubscribed, streamUnreg, streams, notifyHandlers };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let mod: typeof import('../index');
let printState = 'standby';
let homed = 'xyz';
let temperature = 210;
let settings: Record<string, unknown> = {
  pa_tester: { method: 'step_response', high_flow: 12 },
  load_cell: {},
  extruder: { min_extrude_temp: 170 },
  printer: { kinematics: 'corexy' },
};

const fake = createFakeApi({
  'printer.objects.query': (p) => {
    const objects = (p as { objects: Record<string, unknown> }).objects;
    if (objects.configfile) {
      return {
        status: {
          configfile: { settings },
          print_stats: { state: printState },
          toolhead: { homed_axes: homed, extruder: 'extruder' },
        },
      };
    }
    if (objects.extruder) return { status: { extruder: { temperature } } };
    return { status: {} };
  },
  'server.gcode_store': () => ({ gcode_store: [] }),
  'printer.gcode.script': () => ({}),
});

beforeAll(async () => {
  mod = await import('../index');
});

const guard = (script: string) =>
  mod.guardPaTester({ method: 'printer.gcode.script', params: { script }, targetPrinterId: 'p1' }, 't', {
    targetPrinterId: 'p1',
  });

type TabEl = HTMLElement & { api: PluginApi; params: unknown; updateComplete: Promise<boolean> };

async function mount(tag: string): Promise<TabEl> {
  const el = document.createElement(tag) as TabEl;
  el.api = fake.api;
  el.params = {};
  document.body.append(el);
  await flush();
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

describe('host contract', () => {
  it('registers every element named in manifest.json and the named exports', async () => {
    const manifest = (await import('../../manifest.json')).default;
    for (const e of manifest.extensions) {
      expect(customElements.get(e.element), e.element).toBeDefined();
      // Always shown: without [pa_tester] the tab explains what to add.
      expect('available' in e).toBe(false);
      expect(e.point).toBe('@core/calibrations#tabs');
      expect(e.kind).toBe('tab');
    }
    for (const o of manifest.overlays) expect(customElements.get(o.element), o.element).toBeDefined();
    expect(typeof (mod as Record<string, unknown>)[manifest.guards[0]!.handler]).toBe('function');
    expect(Object.keys(mod.locales)).toEqual(manifest.locales);
    expect(manifest.pluginApi).toBe('0.9');
  });

  it('keeps en and ru in sync, and has the title the host shows on the tab', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(keys(mod.locales.ru).sort()).toEqual(keys(mod.locales.en).sort());
    expect(keys(mod.locales.en)).toContain('patester.tabTitle');
  });

  it('guard allows everything until the plugin has an api', async () => {
    expect(await guard('PA_CALIBRATE')).toEqual({ action: 'allow' });
  });

  it('has no availability export any more', () => {
    expect((mod as Record<string, unknown>).hasPaTester).toBeUndefined();
  });

  it('without [pa_tester] the tab shows instructions, no graph stream, and picks the module up on check', async () => {
    const saved = settings;
    settings = { printer: {}, extruder: { min_extrude_temp: 170 } };
    fake.streams.length = 0;
    const el = await mount('tessera-pa-tester-tab');
    const root = el.shadowRoot!;
    expect(root.textContent).toContain('patester.install.title');
    expect(root.textContent).toContain('patester.install.noLoadCell');
    expect(root.querySelector('a')?.getAttribute('href')).toContain('dmbutyugin/klipper');
    expect(root.textContent).not.toContain('patester.run.test');
    expect(fake.streams).toHaveLength(0);

    settings = saved;
    [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'patester.install.recheck')!.click();
    await flush();
    await el.updateComplete;
    expect(root.textContent).toContain('patester.run.test');
    expect(root.textContent).not.toContain('patester.install.title');
    el.remove();
    fake.streams.length = 0; // the graph of the recognised module opened one
  });

  it('guard: pa_tester commands only — not while printing, unhomed or cold', async () => {
    expect(await guard('G28\nSHAPER_CALIBRATE')).toEqual({ action: 'allow' });
    expect(await guard('PA_CALIBRATE')).toEqual({ action: 'allow' });
    expect(await guard('TEST_PRESSURE_ADVANCE METHOD=step_response')).toEqual({ action: 'allow' });

    printState = 'printing';
    expect(await guard('PA_CALIBRATE')).toEqual({ action: 'deny', reasonKey: 'patester.guard.printing' });
    printState = 'standby';
    homed = 'xy';
    expect(await guard('test_pressure_advance')).toEqual({ action: 'deny', reasonKey: 'patester.guard.homing' });
    homed = 'xyz';
    temperature = 25;
    expect(await guard('PA_CALIBRATE')).toEqual({ action: 'deny', reasonKey: 'patester.guard.cold' });
    temperature = 210;

    expect(
      await mod.guardPaTester({ method: 'printer.print.start', params: {}, targetPrinterId: 'p1' }, 't', { targetPrinterId: 'p1' }),
    ).toEqual({ action: 'allow' });
  });

  it('mounts like the host, renders into a shadow root, streams the load cell, releases on removal', async () => {
    const el = await mount('tessera-pa-tester-tab');
    const root = el.shadowRoot!;
    expect(root).not.toBeNull();
    expect(root.textContent).toContain('patester.title');
    expect(root.textContent).toContain('patester.command.test');
    expect(root.querySelector('code')?.textContent).toBe('TEST_PRESSURE_ADVANCE METHOD=step_response');
    expect(root.textContent).toContain('PA 0.0400');

    // help: a top-layer popover opened by its invoker
    const helpBtn = root.querySelector('.help-btn')!;
    const help = root.getElementById(helpBtn.getAttribute('popovertarget')!)!;
    expect(help.getAttribute('popover')).toBe('auto');
    expect(help.closest('.panel-body')).toBeNull();

    // The live graph asks the host for the stream, by the name of the only load cell.
    expect(fake.streams).toHaveLength(1);
    expect(fake.streams[0]!.method).toBe('load_cell/dump_force');
    expect(fake.streams[0]!.params).toEqual({ sensor: 'load_cell' });
    fake.streams[0]!.onStatus('live');
    fake.streams[0]!.onData({ data: [[1, 12.5, 0, 0], [1.01, 13.5, 0, 0] /* one 20 ms bin: averaged */] });
    await el.updateComplete;
    expect(root.textContent).toContain('patester.chart.sourceStream');
    expect(root.textContent).toMatch(/patester\.chart\.now\s+13\.00 g/);

    // A run started elsewhere shows up in the tab.
    fake.notifyHandlers.get('notify_gcode_response')!(['// Detected extrude_force_sign=1\n// PA calibration results:']);
    await el.updateComplete;
    expect(root.textContent).toContain('patester.run.external');
    fake.notifyHandlers.get('notify_gcode_response')!(['//   overall pressure_advance=0.045']);
    await el.updateComplete;
    expect(root.textContent).toContain('0.045');

    el.params = { anything: '1' };
    await el.updateComplete;
    expect(root.textContent).toContain('patester.title');

    const before = fake.streamUnreg.mock.calls.length;
    el.remove();
    expect(fake.streamUnreg.mock.calls.length).toBe(before + 1);
  });

  it('hiding the graph stops the stream', async () => {
    fake.streamUnreg.mockClear();
    const el = await mount('tessera-pa-tester-tab');
    const hide = [...el.shadowRoot!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'patester.chart.hide')!;
    hide.click();
    await el.updateComplete;
    expect(fake.streamUnreg).toHaveBeenCalledTimes(1);
    el.remove();
  });

  it('Test runs at once; Calibrate asks for a confirmation first', async () => {
    const el = await mount('tessera-pa-tester-tab');
    // finish the external run of the previous test
    fake.notifyHandlers.get('notify_gcode_response')?.(['//   overall pressure_advance=0.045']);
    await el.updateComplete;
    const root = el.shadowRoot!;
    const button = (label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

    fake.handle.request.mockClear();
    button('patester.run.test').click();
    await flush();
    expect(fake.handle.request).toHaveBeenCalledWith('printer.gcode.script', {
      script: 'TEST_PRESSURE_ADVANCE METHOD=step_response',
    });

    button('patester.command.calibrate').click();
    await el.updateComplete;
    const dialog = root.querySelector('dialog') as HTMLDialogElement;
    dialog.showModal = vi.fn();
    dialog.close = vi.fn();
    fake.handle.request.mockClear();
    button('patester.run.calibrate').click();
    expect(dialog.showModal).toHaveBeenCalled();
    expect(fake.handle.request).not.toHaveBeenCalled();

    button('patester.confirm.ok').click();
    await flush();
    expect(fake.handle.request).toHaveBeenCalledWith('printer.gcode.script', {
      script: 'PA_CALIBRATE METHOD=step_response',
    });
    el.remove();
  });

  it('the bridge overlay renders nothing', async () => {
    const el = await mount('tessera-pa-tester-bridge');
    expect(el.shadowRoot?.textContent ?? '').toBe('');
    el.remove();
  });
});
