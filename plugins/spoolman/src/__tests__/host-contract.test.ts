// @vitest-environment happy-dom
/**
 * Plays the host's role against the real plugin module:
 * createElement(tag) → el.api / el.params → append, then calls the guard the
 * way the GuardAgent does and resolves it through the overlay UI.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../sdk';

type Handler = (params: unknown) => unknown;

function createFakeApi(responses: Record<string, Handler>) {
  const resume = vi.fn();
  const handle = {
    readyState: 'open',
    httpBaseUrl: 'http://printer',
    authToken: null,
    request: vi.fn(async (method: string, params?: unknown) => {
      const h = responses[method];
      if (!h) throw new Error(`unexpected request ${method}`);
      return h(params);
    }),
    subscribe: vi.fn(() => () => {}),
    onNotify: vi.fn(() => () => {}),
    onReady: vi.fn(() => () => {}),
    onConnectionStatusChange: vi.fn(() => () => {}),
    poll: vi.fn(() => () => {}),
  };
  const printer = { id: 'p1', name: 'Voron', url: '192.168.1.5' };
  const api = {
    pluginId: 'tessera/spoolman',
    printer,
    printers: [printer],
    moonraker: () => handle,
    moonrakerFor: () => handle,
    onPrinterChange: () => () => {},
    onPrintersChange: () => () => {},
    onLocaleChange: () => () => {},
    onThemeChange: () => () => {},
    i18n: { locale: 'en', t: (key: string) => key },
    settings: { get: () => undefined, set: () => {}, onChange: () => () => {} },
    guards: { resume },
  } as unknown as PluginApi;
  return { api, handle, resume };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let mod: typeof import('../index');
const spool = { id: 3, remaining_weight: 500, filament: { id: 1, material: 'PLA', name: 'Basic', color_hex: 'ff0000', weight: 1000 } };
let metadata: Record<string, unknown> = {};
const { api, handle, resume } = createFakeApi({
  'server.info': () => ({ components: ['spoolman'] }),
  'printer.objects.list': () => ({ objects: ['extruder'] }),
  'server.spoolman.get_spool_id': () => ({ spool_id: 3 }),
  'server.spoolman.status': () => ({ spoolman_connected: true }),
  'server.files.metadata': () => metadata,
  'server.spoolman.proxy': () => ({ response: spool, error: null }),
});

beforeAll(async () => {
  mod = await import('../index');
});

describe('host contract', () => {
  it('registers every element named in manifest.json and the named exports', async () => {
    const manifest = (await import('../../manifest.json')).default;
    const tags = [
      ...manifest.pages.map((p: { element: string }) => p.element),
      ...manifest.widgets.flatMap((w: { element: string; headerElement: string }) => [w.element, w.headerElement]),
      ...manifest.overlays.map((o: { element: string }) => o.element),
    ];
    for (const tag of tags) expect(customElements.get(tag), tag).toBeDefined();
    expect(typeof (mod as Record<string, unknown>)[manifest.guards[0]!.handler]).toBe('function');
    expect(Object.keys(mod.locales)).toEqual(manifest.locales);
    expect(mod.pageIcons[manifest.pages[0]!.icon]).toContain('<svg');
  });

  it('allows the print when nothing has connected yet (no api)', async () => {
    const decision = await mod.guardPrintStart(
      { method: 'printer.print.start', params: { filename: 'a.gcode' }, targetPrinterId: 'p1' }, 't0', { targetPrinterId: 'p1' },
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('mounts the overlay like the host: properties before connect, empty while closed', async () => {
    const el = document.createElement('tessera-spoolman-overlay') as HTMLElement & { api: PluginApi; params: unknown };
    el.api = api;
    el.params = {};
    document.body.append(el);
    await flush();
    expect(el.innerHTML).toBe('');
    // the api reached the tracker: printer p1 is being loaded
    expect(handle.request).toHaveBeenCalledWith('server.info');
  });

  it('allows a print whose material and amount match', async () => {
    metadata = { filament_type: 'PLA', filament_weight_total: 20 };
    const decision = await mod.guardPrintStart(
      { method: 'printer.print.start', params: { filename: 'a.gcode' }, targetPrinterId: 'p1' }, 't1', { targetPrinterId: 'p1' },
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('ignores other methods', async () => {
    const decision = await mod.guardPrintStart(
      { method: 'printer.gcode.script', params: {}, targetPrinterId: 'p1' }, 't2', { targetPrinterId: 'p1' },
    );
    expect(decision).toEqual({ action: 'allow' });
  });

  it('freezes on a mismatch, shows the dialog and resumes through the button', async () => {
    metadata = { filament_type: 'PETG', filament_weight_total: 20 };
    const decision = await mod.guardPrintStart(
      { method: 'printer.print.start', params: { filename: 'b.gcode' }, targetPrinterId: 'p1' }, 't3', { targetPrinterId: 'p1' },
    );
    expect(decision).toEqual({ action: 'freeze' });

    await flush();
    const overlay = document.querySelector('tessera-spoolman-overlay')!;
    expect(overlay.textContent).toContain('spoolman.check.title');
    expect(overlay.textContent).toContain('spoolman.issue.material');

    const buttons = [...overlay.querySelectorAll('button')];
    const anyway = buttons.find((b) => b.textContent === 'spoolman.check.printAnyway')!;
    anyway.click();
    expect(resume).toHaveBeenCalledWith('t3', 'accept', undefined);

    await flush();
    expect(overlay.innerHTML).toBe('');
  });

  it('cancel denies with the plugin reason key', async () => {
    metadata = { filament_type: 'PLA', filament_weight_total: 900 };
    await mod.guardPrintStart(
      { method: 'printer.print.start', params: { filename: 'c.gcode' }, targetPrinterId: 'p1' }, 't4', { targetPrinterId: 'p1' },
    );
    await flush();
    const overlay = document.querySelector('tessera-spoolman-overlay')!;
    expect(overlay.textContent).toContain('spoolman.issue.insufficient');
    [...overlay.querySelectorAll('button')].find((b) => b.textContent === 'spoolman.check.cancel')!.click();
    expect(resume).toHaveBeenCalledWith('t4', 'deny', 'spoolman.guard.cancelled');
  });

  it('re-renders on params changes of a live element and unmounts on disconnect', async () => {
    const el = document.createElement('tessera-spoolman-widget') as HTMLElement & { api: PluginApi; params: unknown };
    el.api = api;
    el.params = {};
    document.body.append(el);
    await flush();
    expect(el.textContent).toContain('#3 Basic');
    el.params = { edit: '1' };
    await flush();
    expect(el.textContent).toContain('#3 Basic');
    el.remove();
    expect(el.innerHTML).toBe('');
  });
});
