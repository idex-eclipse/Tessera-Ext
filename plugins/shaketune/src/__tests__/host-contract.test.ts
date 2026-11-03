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

type Handler = (params: unknown) => unknown;

function createFakeApi(responses: Record<string, Handler>) {
  const unsubscribed = vi.fn();
  const notifyHandlers = new Map<string, (params: unknown) => void>();
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
      cb({ print_stats: { state: 'standby' }, toolhead: { homed_axes: 'xyz' }, webhooks: { state: 'ready' } });
      return unsubscribed;
    }),
    onNotify: vi.fn((event: string, cb: (params: unknown) => void) => {
      notifyHandlers.set(event, cb);
      return unsubscribed;
    }),
    onReady: vi.fn(() => () => {}),
    onConnectionStatusChange: vi.fn(() => () => {}),
    poll: vi.fn(() => () => {}),
  };
  const printer = { id: 'p1', name: 'Voron', url: 'http://printer' };
  const store: Record<string, unknown> = {};
  const api = {
    pluginId: 'tessera/shaketune',
    printer,
    printers: [printer],
    moonraker: () => handle,
    moonrakerFor: () => handle,
    onPrinterChange: () => unsubscribed,
    onPrintersChange: () => () => {},
    onLocaleChange: () => unsubscribed,
    onThemeChange: () => () => {},
    i18n: { locale: 'en', t: (key: string) => key },
    settings: { get: (k: string) => store[k], set: (k: string, v: unknown) => (store[k] = v), onChange: () => () => {} },
    guards: { resume: vi.fn() },
  } as unknown as PluginApi;
  return { api, handle, unsubscribed, notifyHandlers };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let mod: typeof import('../index');
let printState = 'standby';
let homed = 'xyz';
let settings: Record<string, unknown> = { shaketune: {}, printer: { kinematics: 'corexy' } };

const fake = createFakeApi({
  'printer.objects.query': (p) => {
    const objects = (p as { objects: Record<string, unknown> }).objects;
    if (objects.configfile) return { status: { configfile: { settings } } };
    return { status: { print_stats: { state: printState }, toolhead: { homed_axes: homed } } };
  },
  'server.gcode_store': () => ({ gcode_store: [] }),
  'server.files.get_directory': () => ({ files: [] }),
  'printer.gcode.script': () => ({}),
});

beforeAll(async () => {
  mod = await import('../index');
});

const guard = (script: string) =>
  mod.guardShakeTune({ method: 'printer.gcode.script', params: { script }, targetPrinterId: 'p1' }, 't', {
    targetPrinterId: 'p1',
  });

describe('host contract', () => {
  it('registers every element named in manifest.json and the named exports', async () => {
    const manifest = (await import('../../manifest.json')).default;
    for (const e of manifest.extensions) {
      expect(customElements.get(e.element), e.element).toBeDefined();
      expect(typeof (mod as Record<string, unknown>)[e.available]).toBe('function');
      expect(e.point).toBe('@core/calibrations#shaper');
    }
    for (const o of manifest.overlays) expect(customElements.get(o.element), o.element).toBeDefined();
    expect(typeof (mod as Record<string, unknown>)[manifest.guards[0]!.handler]).toBe('function');
    expect(Object.keys(mod.locales)).toEqual(manifest.locales);
  });

  it('keeps en and ru in sync', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(keys(mod.locales.ru).sort()).toEqual(keys(mod.locales.en).sort());
  });

  it('guard allows everything until the plugin has an api', async () => {
    expect(await guard('AXES_SHAPER_CALIBRATION')).toEqual({ action: 'allow' });
  });

  it('available follows the [shaketune] section', async () => {
    expect(await mod.hasShakeTune(fake.api)).toBe(true);
    settings = { printer: { kinematics: 'corexy' } };
    expect(await mod.hasShakeTune(fake.api)).toBe(false);
    settings = { shaketune: {}, printer: { kinematics: 'corexy' } };
  });

  it('guard: ST commands only — not while printing, not unhomed', async () => {
    // hasShakeTune above stored the api, like the bridge overlay does at app start.
    expect(await guard('G28\nSHAPER_CALIBRATE')).toEqual({ action: 'allow' });
    expect(await guard('_COMPARE_BELTS_RESPONSES')).toEqual({ action: 'allow' });

    printState = 'printing';
    expect(await guard('AXES_SHAPER_CALIBRATION AXIS=x')).toEqual({ action: 'deny', reasonKey: 'shaketune.guard.printing' });
    printState = 'standby';
    homed = 'xy';
    expect(await guard('AXES_MAP_CALIBRATION')).toEqual({ action: 'deny', reasonKey: 'shaketune.guard.homing' });
    homed = 'xyz';

    expect(await mod.guardShakeTune({ method: 'printer.print.start', params: {}, targetPrinterId: 'p1' }, 't', { targetPrinterId: 'p1' }))
      .toEqual({ action: 'allow' });
  });

  it('mounts like the host, renders into a shadow root, re-renders on params, releases on removal', async () => {
    const el = document.createElement('tessera-shaketune-tab') as HTMLElement & {
      api: PluginApi;
      params: unknown;
      updateComplete: Promise<boolean>;
    };
    el.api = fake.api;
    el.params = {};
    document.body.append(el);
    await flush();
    await el.updateComplete;
    await flush();
    await el.updateComplete;

    const root = el.shadowRoot!;
    expect(root).not.toBeNull();
    expect(root.textContent).toContain('shaketune.title');
    expect(root.textContent).toContain('shaketune.command.shaper');
    expect(root.querySelector('code')?.textContent).toBe('AXES_SHAPER_CALIBRATION');
    // help: a top-layer popover opened by its invoker, not a box inside the clipped panel
    const helpBtn = root.querySelector('.help-btn')!;
    const help = root.getElementById(helpBtn.getAttribute('popovertarget')!)!;
    expect(help.getAttribute('popover')).toBe('auto');
    expect(help.closest('.panel-body')).toBeNull();
    expect(fake.notifyHandlers.has('notify_gcode_response')).toBe(true);

    // A live console line of an external run shows up in the tab.
    fake.notifyHandlers.get('notify_gcode_response')!(['// Shake&Tune version: v6.0.0\n// Measuring axis_X...']);
    await el.updateComplete;
    expect(root.textContent).toContain('shaketune.run.external');

    el.params = { anything: '1' };
    await el.updateComplete;
    expect(root.textContent).toContain('shaketune.title');

    const before = fake.unsubscribed.mock.calls.length;
    el.remove();
    expect(fake.unsubscribed.mock.calls.length).toBeGreaterThan(before);
  });

  it('Run sends the command built from the form', async () => {
    const el = document.createElement('tessera-shaketune-tab') as HTMLElement & {
      api: PluginApi;
      params: unknown;
      updateComplete: Promise<boolean>;
    };
    el.api = fake.api;
    el.params = {};
    // a previous test left an external run of p1 going; finish it
    fake.notifyHandlers.get('notify_gcode_response')?.(['// input shaper graphs created successfully!']);
    document.body.append(el);
    await flush();
    await el.updateComplete;

    const run = [...el.shadowRoot!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'shaketune.run.run')!;
    expect(run.disabled).toBe(false);
    run.click();
    await flush();
    expect(fake.handle.request).toHaveBeenCalledWith('printer.gcode.script', { script: 'AXES_SHAPER_CALIBRATION' });
    el.remove();
  });

  it('the bridge overlay renders nothing', async () => {
    const el = document.createElement('tessera-shaketune-bridge') as HTMLElement & { api: PluginApi; params: unknown; updateComplete: Promise<boolean> };
    el.api = fake.api;
    el.params = {};
    document.body.append(el);
    await el.updateComplete;
    expect(el.shadowRoot?.textContent ?? '').toBe('');
    el.remove();
  });
});
