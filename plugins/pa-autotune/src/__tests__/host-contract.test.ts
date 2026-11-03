// @vitest-environment happy-dom
// @vitest-environment-options {"url": "http://tessera.local:8000/", "settings": {"disableIframePageLoading": true, "handleDisabledFileLoadingAsSuccess": true}}
/**
 * Plays the host's role against the real plugin module:
 * - checks every tag and named export manifest.json refers to;
 * - mounts the extension like PluginElementHost: createElement(tag) →
 *   el.api / el.params → append, then removes it;
 * - none / one / two providers, the switcher, the address field.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../sdk';

type Handler = (params: unknown) => unknown;

function createFakeApi(responses: Record<string, Handler>) {
  const unsubscribed = vi.fn();
  const notifyHandlers = new Map<string, () => void>();
  const store: Record<string, unknown> = {};
  const printerListeners: Array<() => void> = [];
  const handle = {
    request: vi.fn(async (method: string, params?: unknown) => {
      const h = responses[method];
      if (!h) throw new Error(`unexpected request ${method}`);
      return h(params);
    }),
    onNotify: vi.fn((event: string, cb: () => void) => {
      notifyHandlers.set(event, cb);
      return unsubscribed;
    }),
  };
  const printer = { id: 'p1', name: 'Voron', url: 'http://printer.local:7125' };
  const api = {
    pluginId: 'tessera/pa-autotune',
    printer,
    moonraker: () => handle,
    moonrakerFor: () => handle,
    onPrinterChange: (cb: () => void) => {
      printerListeners.push(cb);
      return unsubscribed;
    },
    onLocaleChange: () => unsubscribed,
    onThemeChange: () => unsubscribed,
    i18n: { locale: 'en', t: (key: string) => key },
    settings: { get: (k: string) => store[k], set: (k: string, v: unknown) => (store[k] = v), onChange: () => () => {} },
  } as unknown as PluginApi;
  return { api, handle, store, notifyHandlers, unsubscribed };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let helpCommands: string[] = [];
let objects: string[] = [];
let printState = 'standby';
let fake = build();

function build() {
  return createFakeApi({
    'printer.gcode.help': () => Object.fromEntries(helpCommands.map((c) => [c, 'help'])),
    'printer.objects.list': () => ({ objects }),
    'printer.objects.query': () => ({ status: { print_stats: { state: printState } } }),
  });
}

// Tessera's own site answers the same page for any path (SPA fallback); the printer
// site (other origin) answers anything: probing then picks the printer's port 80.
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ ok: boolean; text: () => Promise<string> }>>();
const tesseraAnswer = async () => ({ ok: true, text: async () => 'TESSERA' });

let mod: typeof import('../index');

beforeAll(async () => {
  mod = await import('../index');
});

beforeEach(() => {
  helpCommands = [];
  objects = [];
  printState = 'standby';
  fake = build();
  fetchMock.mockReset();
  fetchMock.mockImplementation(tesseraAnswer);
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

type TabEl = HTMLElement & { api: PluginApi; params: unknown; updateComplete: Promise<boolean> };

async function mount(tag = 'tessera-pa-autotune-tab'): Promise<TabEl> {
  const el = document.createElement(tag) as TabEl;
  el.api = fake.api;
  el.params = {};
  document.body.append(el);
  for (let i = 0; i < 4; i++) {
    await flush();
    await el.updateComplete;
  }
  return el;
}

const buttons = (el: TabEl) => [...el.shadowRoot!.querySelectorAll('button')];
const button = (el: TabEl, label: string) => buttons(el).find((b) => b.textContent?.trim() === label)!;

describe('host contract', () => {
  it('registers every element named in manifest.json and the named exports', async () => {
    const manifest = (await import('../../manifest.json')).default;
    for (const e of manifest.extensions) {
      expect(customElements.get(e.element), e.element).toBeDefined();
      expect(e.point).toBe('@core/calibrations#tabs');
      expect(e.kind).toBe('tab');
      // The tab is always shown: nothing to ask the plugin about.
      expect('available' in e).toBe(false);
    }
    for (const o of manifest.overlays) expect(customElements.get(o.element), o.element).toBeDefined();
    expect(typeof (mod as Record<string, unknown>)[manifest.guards[0]!.handler]).toBe('function');
    expect(Object.keys(mod.locales)).toEqual(manifest.locales);
  });

  it('keeps en and ru in sync, and has the title the host shows on the tab', () => {
    const keys = (o: object, prefix = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
    expect(keys(mod.locales.ru).sort()).toEqual(keys(mod.locales.en).sort());
    expect(keys(mod.locales.en)).toContain('paautotune.tabTitle');
  });

  it('with no provider shows the instructions of both and a load cell warning', async () => {
    const el = await mount();
    const root = el.shadowRoot!;
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.textContent).toContain('paautotune.none.title');
    const code = [...root.querySelectorAll('.gcode')].map((c) => c.textContent);
    expect(code).toContain('git clone https://github.com/G0BL1N/autopa.git');
    expect(code).toContain('git clone https://github.com/vzagranichnyy/KAPAT.git');
    expect(root.textContent).toContain('paautotune.none.noLoadCell');
    el.remove();
  });

  it('check again finds a provider installed meanwhile', async () => {
    const el = await mount();
    helpCommands = ['KAPAT_SWEEP'];
    button(el, 'paautotune.none.recheck').click();
    for (let i = 0; i < 4; i++) {
      await flush();
      await el.updateComplete;
    }
    expect(el.shadowRoot!.querySelector('iframe')).not.toBeNull();
    el.remove();
  });

  it('klippy_ready makes the tab look again', async () => {
    const el = await mount();
    expect(el.shadowRoot!.querySelector('iframe')).toBeNull();
    helpCommands = ['AUTOPA_SWEEP'];
    fake.notifyHandlers.get('notify_klippy_ready')!();
    for (let i = 0; i < 4; i++) {
      await flush();
      await el.updateComplete;
    }
    expect(el.shadowRoot!.querySelector('iframe')).not.toBeNull();
    el.remove();
  });

  it('one provider: its UI in an iframe, no switcher, on the printer site when this site has none', async () => {
    helpCommands = ['AUTOPA_SWEEP'];
    const el = await mount();
    const root = el.shadowRoot!;
    const frame = root.querySelector('iframe')!;
    expect(frame).not.toBeNull();
    expect(frame.getAttribute('title')).toBe('autopa');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    // tessera.local:8000 answers its own index for /autopa/ → printer.local:80
    expect(frame.getAttribute('src')).toBe('http://printer.local/autopa/');
    expect(root.querySelector('[role="tablist"]')).toBeNull();
    expect(root.textContent).not.toContain('paautotune.frame.kapatChart');
    el.remove();
  });

  it('two providers: switcher, remembered choice, KAPAT hint', async () => {
    helpCommands = ['AUTOPA_SWEEP', 'KAPAT_SWEEP'];
    const el = await mount();
    const root = el.shadowRoot!;
    expect(root.querySelector('iframe')!.getAttribute('title')).toBe('autopa');
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(2);

    button(el, 'KAPAT').click();
    for (let i = 0; i < 4; i++) {
      await flush();
      await el.updateComplete;
    }
    expect(fake.store.provider).toBe('kapat');
    expect(root.querySelector('iframe')!.getAttribute('src')).toBe('http://printer.local/kapat/');
    expect(root.textContent).toContain('paautotune.frame.kapatChart');
    el.remove();

    // A new mount starts on the saved provider.
    const again = await mount();
    expect(again.shadowRoot!.querySelector('iframe')!.getAttribute('title')).toBe('KAPAT');
    again.remove();
  });

  it('a saved provider that was uninstalled gives way to the other one', async () => {
    fake.store.provider = 'kapat';
    helpCommands = ['AUTOPA_SWEEP'];
    const el = await mount();
    expect(el.shadowRoot!.querySelector('iframe')!.getAttribute('title')).toBe('autopa');
    el.remove();
  });

  it('own address: saved per provider, used without probing, reset returns to the search', async () => {
    helpCommands = ['AUTOPA_SWEEP'];
    const el = await mount();
    const root = el.shadowRoot!;

    button(el, 'paautotune.frame.address').click();
    await el.updateComplete;
    const input = root.querySelector('input')!;
    input.value = 'nas.local:8080/autopa/';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    button(el, 'paautotune.frame.save').click();
    for (let i = 0; i < 4; i++) {
      await flush();
      await el.updateComplete;
    }
    expect(fake.store['url.autopa']).toBe('nas.local:8080/autopa/');
    expect(root.querySelector('iframe')!.getAttribute('src')).toBe('http://nas.local:8080/autopa/');

    button(el, 'paautotune.frame.address').click();
    await el.updateComplete;
    button(el, 'paautotune.frame.reset').click();
    for (let i = 0; i < 4; i++) {
      await flush();
      await el.updateComplete;
    }
    expect(fake.store['url.autopa']).toBeNull();
    expect(root.querySelector('iframe')!.getAttribute('src')).toBe('http://printer.local/autopa/');
    el.remove();
  });

  it('an invalid own address is refused and not saved', async () => {
    helpCommands = ['AUTOPA_SWEEP'];
    const el = await mount();
    button(el, 'paautotune.frame.address').click();
    await el.updateComplete;
    const input = el.shadowRoot!.querySelector('input')!;
    input.value = 'javascript:alert(1)';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    button(el, 'paautotune.frame.save').click();
    await el.updateComplete;
    expect(fake.store['url.autopa']).toBeUndefined();
    expect(input.classList.contains('invalid')).toBe(true);
    el.remove();
  });

  it('nothing answers: says what was tried and keeps the address field reachable', async () => {
    helpCommands = ['KAPAT_SWEEP'];
    fetchMock.mockImplementation(async () => {
      throw new TypeError('refused');
    });
    const el = await mount();
    const root = el.shadowRoot!;
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.textContent).toContain('paautotune.frame.unreachableTitle');
    expect(button(el, 'paautotune.frame.address')).toBeDefined();
    el.remove();
  });

  it('releases subscriptions on removal', async () => {
    const el = await mount();
    fake.unsubscribed.mockClear();
    el.remove();
    expect(fake.unsubscribed).toHaveBeenCalled();
  });

  it('the bridge overlay renders nothing', async () => {
    const el = await mount('tessera-pa-autotune-bridge');
    expect(el.shadowRoot?.textContent ?? '').toBe('');
    el.remove();
  });

  it('the guard allows everything it does not watch', async () => {
    expect(
      await mod.guardPaAutotune({ method: 'printer.gcode.script', params: { script: 'G28' }, targetPrinterId: 'p1' }, 't', {
        targetPrinterId: 'p1',
      }),
    ).toEqual({ action: 'allow' });
  });
});
