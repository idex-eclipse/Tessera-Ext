// @vitest-environment happy-dom
/**
 * Plays the host's role against the real plugin module:
 * - checks every tag and named export manifest.json refers to, and every i18n key the code uses;
 * - mounts the elements like PluginElementHost: createElement(tag) -> el.api / el.params ->
 *   append, clicks through their actions, then removes them;
 * - fakes `api.services` as the Obico server behind Tessera's proxy.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetHub } from '../core/hub';
import type { ObicoPrinter } from '../core/obico-api';
import type { PluginApi } from '../sdk';

type Handler = (params: unknown) => unknown;

/** The Obico printer the fake server reports; tests change it. */
let obicoPrinter: ObicoPrinter;
const serverCalls: Array<{ path: string; method: string; body?: unknown }> = [];

function basePrinter(): ObicoPrinter {
  return {
    id: 3,
    name: 'Voron in Obico',
    normalized_p: 0.12,
    watching_enabled: true,
    not_watching_reason: null,
    action_on_failure: 'PAUSE',
    detective_sensitivity: 1,
    tools_off_on_pause: true,
    bed_off_on_pause: false,
    retract_on_pause: 6.5,
    lift_z_on_pause: 2.5,
    pic: { img_url: 'http://obico.local:3334/media/tsd-pics/raw/3/1.jpg?digest=x' },
    status: { state: { text: 'Printing', flags: { printing: true, paused: false } } },
    current_print: {
      id: 77,
      filename: 'cube.gcode',
      started_at: '2026-11-07T10:00:00Z',
      finished_at: null,
      cancelled_at: null,
      alerted_at: null,
      alert_acknowledged_at: null,
      alert_muted_at: null,
      paused_at: null,
      alert_overwrite: null,
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function createFakeApi(responses: Record<string, Handler>, opts: { configured?: boolean } = {}) {
  const unsubscribed = vi.fn();
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
      cb({ 'gcode_macro OBICO_LINK_STATUS': { is_linked: true, one_time_passcode: '', one_time_passlink: '' } });
      return unsubscribed;
    }),
    onNotify: vi.fn(() => unsubscribed),
    onReady: vi.fn(() => unsubscribed),
    onConnectionStatusChange: vi.fn(() => () => {}),
    poll: vi.fn(() => () => {}),
  };
  let configured = opts.configured ?? true;
  const services = {
    status: vi.fn(async () => ({ name: 'obico', configured, url: configured ? 'http://obico.local:3334' : null, hasSecret: configured })),
    configure: vi.fn(async (_name: string, cfg: { url: string }) => {
      configured = true;
      return { name: 'obico', configured: true, url: cfg.url, hasSecret: true };
    }),
    remove: vi.fn(async () => {
      configured = false;
    }),
    fetch: vi.fn(async (_name: string, path: string, init?: { method?: string; body?: string }) => {
      serverCalls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
      if (path === 'api/v1/printers/') return json([obicoPrinter]);
      if (path.startsWith('api/v1/printer_events/')) {
        return json([{ id: 1, printer: 3, print: 77, event_type: 'STARTED', event_class: 'INFO', event_title: 'Print started', event_text: '<b>cube</b>', created_at: '2026-11-07T10:00:00Z' }]);
      }
      if (path.startsWith('api/v1/prints/stats/')) {
        return json({ total_print_count: 4, total_succeeded_print_count: 3, total_cancelled_print_count: 1, total_print_time: 7200, total_filament_used: 12345 });
      }
      if (path.startsWith('api/v1/prints/')) return json([{ ...basePrinter().current_print, alerted_at: 'x', alert_overwrite: 'FAILED' }]);
      if (path.startsWith('media/')) return new Response(new Blob(['jpg']), { status: 200 });
      return json({ succeeded: true });
    }),
  };
  const printer = { id: 'p1', name: 'Voron', url: 'http://printer' };
  const notifications = { push: vi.fn() };
  const fleet = { publish: vi.fn(), retract: vi.fn() };
  const api = {
    pluginId: 'tessera/obico',
    printer,
    printers: [printer],
    moonraker: () => handle,
    moonrakerFor: () => handle,
    onPrinterChange: () => unsubscribed,
    onPrintersChange: () => () => {},
    onLocaleChange: () => unsubscribed,
    onThemeChange: () => () => {},
    i18n: { locale: 'en', t: (key: string) => key },
    services,
    notifications,
    fleet,
  } as unknown as PluginApi;
  return { api, handle, unsubscribed, services, notifications, fleet };
}

/** Moonraker of a printer with a linked agent (Obico id 3). */
const linkedPrinter: Record<string, Handler> = {
  'machine.system_info': () => ({
    system_info: { available_services: ['moonraker-obico'], service_state: { 'moonraker-obico': { active_state: 'active', sub_state: 'running' } } },
  }),
  'printer.objects.list': () => ({ objects: ['gcode_macro OBICO_LINK_STATUS', 'gcode_macro _OBICO_RELINK'] }),
  'server.database.get_item': () => ({ value: 3 }),
  'machine.services.restart': () => 'ok',
  'printer.gcode.script': () => 'ok',
  'printer.print.cancel': () => 'ok',
  'printer.print.resume': () => 'ok',
};

const flush = async (times = 3) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
};

type El = HTMLElement & { api: PluginApi; params: unknown; updateComplete: Promise<boolean> };

async function mount(tag: string, api: PluginApi, params: Record<string, string> = {}): Promise<El> {
  const el = document.createElement(tag) as El;
  el.api = api;
  el.params = params;
  document.body.append(el);
  await flush();
  await el.updateComplete;
  await flush();
  await el.updateComplete;
  return el;
}

/** Text of an element and of the shadow roots of its descendants (nested custom elements). */
function deepText(root: Node): string {
  let text = '';
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) text += n.textContent;
    const sr = (n as Element).shadowRoot;
    if (sr) walk(sr);
    n.childNodes.forEach(walk);
  };
  walk(root);
  return text;
}

function deepButtons(root: Node): HTMLButtonElement[] {
  const out: HTMLButtonElement[] = [];
  const walk = (n: Node) => {
    if (n instanceof HTMLButtonElement) out.push(n);
    const sr = (n as Element).shadowRoot;
    if (sr) walk(sr);
    n.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

const button = (el: Node, text: string) => deepButtons(el).find((b) => b.textContent?.trim() === text);

let mod: typeof import('../index');

beforeAll(async () => {
  mod = await import('../index');
});

beforeEach(() => {
  obicoPrinter = basePrinter();
  serverCalls.length = 0;
  resetHub();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[server]\nurl = http://obico.local:3334\nauth_token = x\n[tunnel]\ndest_port = 80\n')));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:frame', revokeObjectURL: () => {} }));
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('host contract', () => {
  it('registers every element and named export manifest.json refers to', async () => {
    const manifest = (await import('../../manifest.json')).default;
    const tags: string[] = [
      ...manifest.extensions.flatMap((e) => ('element' in e && e.element ? [e.element] : [])),
      ...manifest.overlays.map((o) => o.element),
      ...manifest.widgets.flatMap((w) => ('headerElement' in w && w.headerElement ? [w.element, w.headerElement] : [w.element])),
      ...manifest.chips.flatMap((c) => [c.element, c.pickerElement]),
      ...manifest.printerPanels.map((p) => p.element),
    ];
    for (const tag of tags) expect(customElements.get(tag), tag).toBeDefined();
    for (const e of manifest.extensions) {
      for (const field of ['handler', 'available'] as const) {
        const name = (e as Record<string, unknown>)[field];
        if (typeof name === 'string') expect(typeof (mod as Record<string, unknown>)[name], name).toBe('function');
      }
    }
    expect(manifest.services[0]!.name).toBe('obico');
    expect(Object.keys(mod.locales)).toEqual(manifest.locales);
  });

  it('keeps en and ru in sync and knows every key the code uses', async () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    const en = new Set(keys(mod.locales.en));
    expect(keys(mod.locales.ru).sort()).toEqual([...en].sort());

    // Literal keys in the sources (dynamic ones like `obico.level.${…}` are checked by their values).
    const manifest = readFileSync(join(__dirname, '../../manifest.json'), 'utf8');
    const files = ['', 'core', 'ui'].flatMap((d) =>
      readdirSync(join(__dirname, '..', d))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => readFileSync(join(__dirname, '..', d, f), 'utf8')),
    );
    const used = new Set<string>();
    // 'obico.io' is the cloud's domain in core/config.ts, not a key.
    for (const src of [...files, manifest]) for (const m of src.matchAll(/'(obico\.[A-Za-z0-9.]+)'/g)) if (m[1] !== 'obico.io') used.add(m[1]!);
    for (const lv of ['good', 'fishy', 'failing']) used.add(`obico.level.${lv}`);
    for (const st of ['unknown', 'unavailable', 'unconfigured', 'ready', 'error']) used.add(`obico.api.status.${st}`);
    for (const p of ['week', 'month', 'year']) used.add(`obico.stats.${p}`);
    const missing = [...used].filter((k) => !en.has(k));
    expect(missing).toEqual([]);
  });

  it('shows the install hint when the agent is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const { api } = createFakeApi({
      'machine.system_info': () => ({ system_info: {} }),
      'printer.objects.list': () => ({ objects: [] }),
    });
    const el = await mount('tessera-obico-tab', api);
    expect(el.shadowRoot!.textContent).toContain('obico.missing.title');
  });

  it('tab: link, service, API connection, reaction settings and events', async () => {
    const fake = createFakeApi(linkedPrinter);
    const el = await mount('tessera-obico-tab', fake.api);
    const root = el.shadowRoot!;
    const text = deepText(el);
    expect(text).toContain('obico.link.linked');
    expect(root.querySelector<HTMLAnchorElement>('a.button.primary')?.href).toBe('http://obico.local:3334/printers/3/control/');
    expect(text).toContain('obico.api.connected');
    expect(text).toContain('obico.reaction.title');
    expect(text).toContain('Print started');
    expect(text).not.toContain('<b>');

    button(el, 'obico.service.restart')!.click();
    await flush();
    expect(fake.handle.request).toHaveBeenCalledWith('machine.services.restart', { service: 'moonraker-obico' });

    // Re-link asks first: nothing is sent until the confirmation.
    button(el, 'obico.link.relink')!.click();
    await el.updateComplete;
    expect(fake.handle.request).not.toHaveBeenCalledWith('printer.gcode.script', expect.anything());
    button(el, 'obico.link.confirm')!.click();
    await flush();
    expect(fake.handle.request).toHaveBeenCalledWith('printer.gcode.script', { script: '_OBICO_RELINK' });

    const before = fake.unsubscribed.mock.calls.length;
    el.remove();
    expect(fake.unsubscribed.mock.calls.length).toBeGreaterThan(before);
  });

  it('tab: saving the connection sends the token once and never shows it', async () => {
    const fake = createFakeApi(linkedPrinter, { configured: false });
    const el = await mount('tessera-obico-tab', fake.api);
    const panels = el.shadowRoot!.querySelector('tessera-obico-api')!.shadowRoot!;
    const [url, token] = [...panels.querySelectorAll('input')] as HTMLInputElement[];
    expect(url!.value).toBe('http://obico.local:3334'); // default from moonraker-obico.cfg
    token!.value = 'secret-token';
    token!.dispatchEvent(new Event('input'));
    await flush();
    button(el, 'obico.api.save')!.click();
    await flush(6);
    expect(fake.services.configure).toHaveBeenCalledWith('obico', { url: 'http://obico.local:3334', secret: 'secret-token' });
    expect(token!.value).toBe('');
    expect(deepText(el)).not.toContain('secret-token');
  });

  it('detection widget: gauge and frame, the mute switch in the header', async () => {
    const fake = createFakeApi(linkedPrinter);
    const el = await mount('tessera-obico-detection-widget', fake.api);
    await flush(4);
    const text = deepText(el);
    expect(text).toContain('obico.level.good');
    expect(serverCalls.some((c) => c.path === 'media/tsd-pics/raw/3/1.jpg?digest=x')).toBe(true);
    // The body is only the frame and the gauge; answers to alerts live in the overlay.
    expect(deepButtons(el)).toEqual([]);
    // The live gauge: three zones, the ball on the arc, the label and the percent inside.
    const liveGauge = el.shadowRoot!.querySelector('.gauge')!;
    expect(liveGauge.classList.contains('good')).toBe(true);
    expect(liveGauge.querySelectorAll('.zone').length).toBe(3);
    expect(liveGauge.querySelector('.ball')).not.toBeNull();
    expect(liveGauge.querySelector('.eye-off')).toBeNull();

    // Not watched: grey zones, the eye-off icon and the reason instead of the ball.
    obicoPrinter.not_watching_reason = 'Printer is not actively printing';
    resetHub();
    const el2 = await mount('tessera-obico-detection-widget', fake.api);
    await flush(4);
    const idleGauge = el2.shadowRoot!.querySelector('.gauge')!;
    expect(idleGauge.classList.contains('idle')).toBe(true);
    expect(idleGauge.querySelectorAll('.zone').length).toBe(3);
    expect(idleGauge.querySelector('.ball')).toBeNull();
    expect(idleGauge.querySelector('.eye-off')).not.toBeNull();
    expect(idleGauge.textContent).toContain('obico.reason.notPrinting');

    // The header (headerElement of the widget) carries the "do not watch this print" switch.
    const header = await mount('tessera-obico-detection-header', fake.api);
    await flush(4);
    const input = header.shadowRoot!.querySelector('input')!;
    expect(input.checked).toBe(false);
    expect(deepText(header)).toContain('obico.alert.mute');
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    await flush();
    expect(serverCalls).toContainEqual({ path: 'api/v1/printers/3/mute_current_print/?mute_alert=true', method: 'POST', body: undefined });

    // A muted print shows the switch on, and switching it off unmutes.
    obicoPrinter.current_print!.alert_muted_at = '2026-11-07T10:30:00Z';
    resetHub(); // the hub polls fresh: it keeps parsed copies, not the test's object
    const header2 = await mount('tessera-obico-detection-header', fake.api);
    await flush(4);
    const input2 = header2.shadowRoot!.querySelector('input')!;
    expect(input2.checked).toBe(true);
    input2.checked = false;
    input2.dispatchEvent(new Event('change'));
    await flush();
    expect(serverCalls).toContainEqual({ path: 'api/v1/printers/3/mute_current_print/?mute_alert=false', method: 'POST', body: undefined });

    // No print → the header is empty.
    obicoPrinter.current_print = null;
    resetHub();
    const header3 = await mount('tessera-obico-detection-header', fake.api);
    await flush(4);
    expect(header3.shadowRoot!.querySelector('input')).toBeNull();
  });

  it('stats widget: totals and how the alerts were answered', async () => {
    const fake = createFakeApi(linkedPrinter);
    const el = await mount('tessera-obico-stats-widget', fake.api);
    await flush(6);
    await el.updateComplete;
    const text = deepText(el);
    expect(text).toContain('obico.stats.failures');
    expect(text).toContain('12.3'); // 12345 mm of filament → 12.3 m
    const stats = serverCalls.find((c) => c.path.startsWith('api/v1/prints/stats/'))!;
    expect(stats.path).toContain('filter_by_printer_ids%5B%5D=3');
    expect(stats.path).toContain('group_by=day');
  });

  it('chip and picker', async () => {
    obicoPrinter.normalized_p = 0.8;
    const fake = createFakeApi(linkedPrinter);
    const chip = await mount('tessera-obico-chip', fake.api, { chipId: 'probability', edit: '0', narrow: 'false' });
    expect(chip.shadowRoot!.querySelector('.value')?.textContent).toBe('80%');
    expect(chip.shadowRoot!.querySelector('.value')?.classList.contains('failing')).toBe(true);
    // Watching: the open eye (no <line> in it) carries the accent class.
    const kind = chip.shadowRoot!.querySelector('.kind')!;
    expect(kind.classList.contains('on')).toBe(true);
    expect(kind.querySelector('svg line')).toBeNull();

    // Not watching: the crossed eye without the accent, the percent greyed out.
    obicoPrinter.not_watching_reason = 'Printer is not actively printing';
    resetHub(); // the hub polls fresh: it keeps parsed copies, not the test's object
    const chip2 = await mount('tessera-obico-chip', fake.api, { chipId: 'probability', edit: '0', narrow: 'false' });
    const kind2 = chip2.shadowRoot!.querySelector('.kind')!;
    expect(kind2.classList.contains('on')).toBe(false);
    expect(kind2.querySelector('svg line')).not.toBeNull();
    expect(chip2.shadowRoot!.querySelector('.value')?.classList.contains('idle')).toBe(true);

    const picker = await mount('tessera-obico-chip-picker', fake.api, { edit: '1', placed: '[]' });
    const picked = vi.fn();
    picker.addEventListener('mpu:chip-pick', (e) => picked((e as CustomEvent).detail));
    picker.shadowRoot!.querySelector('button')!.click();
    expect(picked).toHaveBeenCalledWith({ id: 'probability' });
  });

  it('overlay: an alert notifies once, "not a failure" resumes a paused print through Moonraker', async () => {
    obicoPrinter.current_print!.alerted_at = '2026-11-07T10:30:00Z';
    obicoPrinter.status!.state!.flags!.paused = true;
    obicoPrinter.normalized_p = 0.9;
    const fake = createFakeApi(linkedPrinter);
    const el = await mount('tessera-obico-overlay', fake.api);
    await flush(4);
    await el.updateComplete;
    expect(deepText(el)).toContain('obico.alert.title');
    expect(fake.notifications.push).toHaveBeenCalledTimes(1);
    expect(fake.notifications.push.mock.calls[0]![0]).toMatchObject({ severity: 'critical', printerId: 'p1' });

    // The server answers the acknowledgement: the next poll has no pending alert.
    fake.services.fetch.mockImplementationOnce(async (_n: string, path: string, init?: { method?: string }) => {
      serverCalls.push({ path, method: init?.method ?? 'GET' });
      obicoPrinter.current_print!.alert_acknowledged_at = '2026-11-07T10:31:00Z';
      return json({ succeeded: true });
    });
    button(el, 'obico.alert.notFailureResume')!.click();
    await flush(6);
    await el.updateComplete;
    expect(serverCalls).toContainEqual({ path: 'api/v1/printers/3/acknowledge_alert/?alert_overwrite=NOT_FAILED', method: 'POST' });
    expect(fake.handle.request).toHaveBeenCalledWith('printer.print.resume');
    expect(deepText(el)).not.toContain('obico.alert.title');
    expect(fake.notifications.push).toHaveBeenCalledTimes(1);
  });

  it('overlay: cancel asks first, cancels through Moonraker and records a failure', async () => {
    obicoPrinter.current_print!.alerted_at = '2026-11-07T11:00:00Z';
    const fake = createFakeApi(linkedPrinter);
    const el = await mount('tessera-obico-overlay', fake.api);
    await flush(4);
    await el.updateComplete;
    button(el, 'obico.alert.cancel')!.click();
    await el.updateComplete;
    expect(fake.handle.request).not.toHaveBeenCalledWith('printer.print.cancel');
    button(el, 'obico.alert.cancelYes')!.click();
    await flush(6);
    expect(fake.handle.request).toHaveBeenCalledWith('printer.print.cancel');
    expect(serverCalls).toContainEqual({ path: 'api/v1/printers/3/acknowledge_alert/?alert_overwrite=FAILED', method: 'POST', body: undefined });
  });

  it('overlay renders nothing without an alert; fleet panel publishes the alert tag', async () => {
    const fake = createFakeApi(linkedPrinter);
    const overlay = await mount('tessera-obico-overlay', fake.api);
    await flush(4);
    expect(overlay.shadowRoot!.textContent?.trim() ?? '').toBe('');

    obicoPrinter.current_print!.alerted_at = '2026-11-07T12:00:00Z';
    resetHub();
    const panel = await mount('tessera-obico-fleet-panel', fake.api, { printerId: 'p1' });
    await flush(4);
    await panel.updateComplete;
    expect(fake.fleet.publish).toHaveBeenLastCalledWith('p1', expect.objectContaining({ tags: [expect.objectContaining({ id: 'obico-alert' })] }));
    panel.remove();
    expect(fake.fleet.retract).toHaveBeenCalledWith('p1');
  });

  it('banner action: available while watched, mutes the current print', async () => {
    const fake = createFakeApi(linkedPrinter);
    expect(await mod.obicoMuteAvailable(fake.api)).toBe(true);
    await mod.obicoMuteHandler(fake.api);
    expect(serverCalls.some((c) => c.path === 'api/v1/printers/3/mute_current_print/?mute_alert=true')).toBe(true);
    expect(fake.notifications.push).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info' }));
  });
});
