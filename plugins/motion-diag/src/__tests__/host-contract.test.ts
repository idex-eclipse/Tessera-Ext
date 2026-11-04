// @vitest-environment happy-dom
/**
 * Plays the host's role against the real plugin module:
 * - checks the tag, the extension point and the dictionaries manifest.json refers to;
 * - mounts the tab like PluginElementHost (createElement(tag) -> el.api / el.params -> append)
 *   and drives it: look for sources, record, stop, build graphs, remove.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PluginApi } from '../sdk';
import { fakeKlipper, flush } from './helpers/fake-klipper';

// uPlot paints on a canvas, which happy-dom does not provide.
type FakePlot = {
  opts: { series: unknown[]; hooks?: { ready?: Array<(u: unknown) => void> } };
  destroyed: boolean;
  data: unknown;
  u: { over: HTMLElement; scales: { x: { min: number; max: number } }; setScale: ReturnType<typeof vi.fn> };
};
const plots: FakePlot[] = [];
vi.mock('uplot', () => ({
  default: class {
    root = document.createElement('div');
    over = document.createElement('div');
    scales: { x: { min: number; max: number } };
    #rec: FakePlot;
    constructor(opts: FakePlot['opts'], data: unknown, el: HTMLElement) {
      const x = (data as number[][])[0]!;
      this.scales = { x: { min: x[0]!, max: x[x.length - 1]! } };
      this.#rec = { opts, destroyed: false, data, u: this as unknown as FakePlot['u'] };
      plots.push(this.#rec);
      this.root.append(this.over);
      el.append(this.root);
      for (const ready of opts.hooks?.ready ?? []) ready(this);
    }
    // the cursor is in the middle of the plot
    posToVal = () => (this.scales.x.min + this.scales.x.max) / 2;
    setScale = vi.fn((_key: string, r: { min: number; max: number }) => {
      this.scales.x = r;
    });
    setData(d: unknown) {
      this.#rec.data = d;
    }
    setSize = vi.fn();
    destroy() {
      this.#rec.destroyed = true;
      this.root.remove();
    }
  },
}));

const k = fakeKlipper();

type Dict = { [key: string]: string | Dict };
const flat = (o: Dict, prefix = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([key, v]) => (typeof v === 'string' ? [[`${prefix}${key}`, v]] : Object.entries(flat(v, `${prefix}${key}.`)))),
  );

let mod: typeof import('../index');
let strings: Record<string, string>;
let api: PluginApi;
const printer = { id: 'p1', name: 'Voron', url: 'http://printer' };

beforeAll(async () => {
  mod = await import('../index');
  strings = flat(mod.locales.en as Dict);
  api = {
    pluginId: 'tessera/motion-diag',
    printer,
    printers: [printer],
    moonraker: () => k.handle,
    onPrinterChange: () => () => {},
    onLocaleChange: () => () => {},
    onThemeChange: () => () => {},
    i18n: {
      locale: 'en',
      t: (key: string, params?: Record<string, string | number>) =>
        (strings[key] ?? key).replace(/\{(\w+)\}/g, (_m, n: string) => String(params?.[n] ?? '')),
    },
  } as unknown as PluginApi;
});

const text = (key: string): string => strings[key]!;

type TabEl = HTMLElement & { api: PluginApi; params: unknown; updateComplete: Promise<boolean> };

async function settle(el: HTMLElement): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await flush();
    await (el as TabEl).updateComplete;
    for (const child of el.shadowRoot?.querySelectorAll('*') ?? []) {
      if ('updateComplete' in child) await (child as TabEl).updateComplete;
    }
  }
}

/** Finds an element inside the shadow roots of the tab's children. */
function inChild<T extends Element>(tab: HTMLElement, tag: string, selector: string): T[] {
  const child = tab.shadowRoot!.querySelector(tag)!;
  return [...child.shadowRoot!.querySelectorAll<T>(selector)];
}

const button = (tab: HTMLElement, tag: string, label: string): HTMLButtonElement =>
  inChild<HTMLButtonElement>(tab, tag, 'button').find((b) => b.textContent?.trim() === label)!;

describe('host contract', () => {
  it('registers the element, the point and the dictionaries manifest.json names', async () => {
    const manifest = (await import('../../manifest.json')).default;
    expect(manifest.extensions).toHaveLength(1);
    const e = manifest.extensions[0]!;
    expect(customElements.get(e.element)).toBeDefined();
    expect(e).toMatchObject({ point: '@core/system#tabs', kind: 'tab', version: 1 });
    expect(manifest.dependencies).toEqual({ '@core/system': '4.0.0' });
    expect(manifest.pluginApi).toBe('0.12');
    expect(Object.keys(mod.locales)).toEqual(manifest.locales);
    expect(strings[e.titleKey]).toBeTruthy();
  });

  it('keeps en and ru in sync', () => {
    const ru = flat(mod.locales.ru as Dict);
    expect(Object.keys(ru).sort()).toEqual(Object.keys(strings).sort());
    for (const [key, v] of Object.entries(ru)) {
      // placeholders must survive translation
      expect([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key).toEqual(
        [...strings[key]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
      );
    }
  });

  it('has every key the source uses', () => {
    const srcDir = resolve(process.cwd(), 'src') + '/';
    const files = [...readdirSync(srcDir + 'core').map((f) => `core/${f}`), ...readdirSync(srcDir + 'ui').map((f) => `ui/${f}`), 'state.ts'];
    const missing: string[] = [];
    for (const f of files) {
      const code = readFileSync(srcDir + f, 'utf8');
      for (const m of code.matchAll(/'(motiondiag\.[\w.]+)'/g)) if (!(m[1]! in strings)) missing.push(`${f}: ${m[1]}`);
    }
    expect(missing).toEqual([]);
    // keys built from a value: every kind, choice, color and capture state
    const prefixes = ['kind', 'capture.state', 'color'];
    const values: Record<string, string[]> = {
      kind: ['trapq', 'stepq', 'accelerometer', 'angle', 'ldc1612', 'loadcell', 'stallguard'],
      'capture.state': ['idle', 'starting', 'recording', 'stopped', 'failed'],
      color: ['accent', 'heat', 'cool', 'success', 'danger', 'warning', 'text-secondary'],
    };
    for (const p of prefixes) for (const v of values[p]!) expect(strings[`motiondiag.${p}.${v}`], `${p}.${v}`).toBeTruthy();
  });

  it('covers every choice the catalog can offer', async () => {
    const { FUNCS, captureInfo } = await import('../core/catalog');
    const { fixture } = await import('./helpers/fake-klipper');
    const info = captureInfo(fixture);
    for (const def of FUNCS) {
      for (const p of def.params({}, info)) {
        for (const c of p.choices ?? []) if (!c.literal) expect(strings[`motiondiag.choice.${c.value}`], `${def.fn}.${c.value}`).toBeTruthy();
      }
    }
  });
});

describe('the tab', () => {
  let tab: TabEl;

  it('mounts like the host, looks for sources and offers them', async () => {
    tab = document.createElement('tessera-motion-diag-tab') as TabEl;
    tab.api = api;
    tab.params = {};
    document.body.append(tab);
    await settle(tab);

    expect(tab.shadowRoot).not.toBeNull();
    expect(k.handle.klippyRequest).toHaveBeenCalledWith('objects/query', expect.anything());
    const boxes = inChild<HTMLInputElement>(tab, 'tessera-md-capture', 'input[type=checkbox]');
    expect(boxes.length).toBeGreaterThan(5);
    const capture = tab.shadowRoot!.querySelector('tessera-md-capture')!.shadowRoot!;
    expect(capture.textContent).toContain(text('motiondiag.kind.accelerometer'));
    // motan's default: trapq and stepq are selected, the sensors are not
    const checked = boxes.filter((b) => b.checked).length;
    expect(checked).toBeGreaterThan(0);
    expect(checked).toBeLessThan(boxes.length);
    // nothing to draw before there is a capture
    expect(tab.shadowRoot!.querySelector('tessera-md-graphs-panel')!.shadowRoot!.textContent!.trim()).toBe('');
  });

  it('records, stops, and then offers a layout built from what was captured', async () => {
    const capture = tab.shadowRoot!.querySelector('tessera-md-capture')!;
    // add the accelerometer to the default selection
    const accel = [...capture.shadowRoot!.querySelectorAll<HTMLElement>('label.item')].find((l) => l.textContent!.includes('hotend'))!;
    (accel.querySelector('input') as HTMLInputElement).click();
    await settle(tab);

    button(tab, 'tessera-md-capture', text('motiondiag.capture.start')).click();
    await settle(tab);
    k.replay();
    await settle(tab);
    expect(capture.shadowRoot!.textContent).toContain(text('motiondiag.capture.state.recording'));

    button(tab, 'tessera-md-capture', text('motiondiag.capture.stop')).click();
    await settle(tab);
    expect(capture.shadowRoot!.textContent).toContain(text('motiondiag.capture.state.stopped'));

    const panel = tab.shadowRoot!.querySelector('tessera-md-graphs-panel')!.shadowRoot!;
    expect(panel.textContent).toContain(text('motiondiag.graphs.title'));
    // the first available layout is already in place
    expect(panel.querySelectorAll('.graph-row').length).toBeGreaterThan(0);
    const preset = panel.querySelector('select#preset') as HTMLSelectElement;
    expect(preset.querySelectorAll('option').length).toBeGreaterThan(2);
    // the layout in use is the selected one
    expect(preset.selectedOptions[0]!.textContent).not.toBe(text('motiondiag.graphs.presetCustom'));
  });

  it('builds the graphs and draws one chart per row', async () => {
    // Stopping the recording drew the first layout by itself: no button to press.
    const panel = tab.shadowRoot!.querySelector('tessera-md-graphs-panel')!;
    const rows = panel.shadowRoot!.querySelectorAll('.graph-row').length;
    for (let i = 0; i < 40 && plots.filter((p) => !p.destroyed).length < rows; i++) await settle(tab);

    const live = plots.filter((p) => !p.destroyed);
    expect(live).toHaveLength(rows);
    // every chart has the x series and at least one data series
    for (const p of live) expect(p.opts.series.length).toBeGreaterThan(1);
  });

  it('draws a layout as soon as it is chosen from the list, and calls edited graphs custom', async () => {
    const panel = tab.shadowRoot!.querySelector('tessera-md-graphs-panel')!.shadowRoot!;
    const preset = panel.querySelector('select#preset') as HTMLSelectElement;
    const other = [...preset.options].find((o) => o.value && !o.selected)!;
    const before = plots.length;
    preset.value = other.value;
    preset.dispatchEvent(new Event('change'));
    // charts of the old data may flash up first; wait until the computation is over
    const stale = () => tab.shadowRoot!.querySelector('tessera-md-graphs')!.shadowRoot!.textContent!.includes(text('motiondiag.graphs.outdated'));
    for (let i = 0; i < 40 && (plots.length === before || stale()); i++) await settle(tab);
    expect(plots.length).toBeGreaterThan(before);
    expect((panel.querySelector('select#preset') as HTMLSelectElement).value).toBe(other.value);
    // no build button was involved: the chart is not stale
    expect(tab.shadowRoot!.querySelector('tessera-md-graphs')!.shadowRoot!.textContent).not.toContain(text('motiondiag.graphs.outdated'));
  });

  it('Shift + wheel zooms the time axis around the cursor, in every row; a plain wheel does nothing', () => {
    const live = plots.filter((p) => !p.destroyed);
    expect(live.length).toBeGreaterThan(1);
    const first = live[0]!;
    const { min, max } = first.u.scales.x;

    // happy-dom ignores the modifier flags of the event init, so Shift is set by hand
    const wheel = (init: WheelEventInit, shift: boolean): WheelEvent => {
      const e = new WheelEvent('wheel', { ...init, cancelable: true });
      Object.defineProperty(e, 'shiftKey', { value: shift });
      return e;
    };
    const plain = wheel({ deltaY: -100 }, false);
    first.u.over.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(first.u.setScale).not.toHaveBeenCalled();

    const zoomIn = wheel({ deltaY: -100 }, true);
    first.u.over.dispatchEvent(zoomIn);
    expect(zoomIn.defaultPrevented).toBe(true); // the page does not scroll sideways
    for (const p of live) expect(p.u.setScale).toHaveBeenCalledWith('x', expect.anything());
    const zoomed = first.u.scales.x;
    expect(zoomed.max - zoomed.min).toBeLessThan(max - min);
    // the middle of the view stayed where it was
    expect((zoomed.min + zoomed.max) / 2).toBeCloseTo((min + max) / 2, 9);

    // Shift + wheel down zooms back out (browsers may report it as horizontal movement)
    first.u.over.dispatchEvent(wheel({ deltaX: 100 }, true));
    expect(first.u.scales.x.max - first.u.scales.x.min).toBeCloseTo(max - min, 9);
  });

  it('adds a series from the dialog without any motan syntax', async () => {
    const dialog = tab.shadowRoot!.querySelector('tessera-md-dataset-dialog') as HTMLElement & { open(rowId: string | null): void };
    // happy-dom has no modal dialogs
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    };
    const rowsBefore = tab.shadowRoot!.querySelector('tessera-md-graphs-panel')!.shadowRoot!.querySelectorAll('.graph-row').length;
    dialog.open(null);
    await settle(tab);
    const root = dialog.shadowRoot!;
    expect(root.textContent).toContain(text('motiondiag.dialog.title'));
    const kind = root.querySelector('select')!;
    kind.value = 'accelerometer';
    kind.dispatchEvent(new Event('change'));
    await settle(tab);
    expect(root.textContent).toContain(text('motiondiag.dialog.result'));
    expect(root.textContent).toContain('hotend x acceleration');
    (root.querySelectorAll('button.primary')[0] as HTMLButtonElement).click();
    await settle(tab);
    const rowsAfter = tab.shadowRoot!.querySelector('tessera-md-graphs-panel')!.shadowRoot!.querySelectorAll('.graph-row').length;
    expect(rowsAfter).toBe(rowsBefore + 1);
    // the settings changed, so the charts are marked stale until rebuilt
    expect(tab.shadowRoot!.querySelector('tessera-md-graphs')!.shadowRoot!.textContent).toContain(text('motiondiag.graphs.outdated'));
  });

  it('keeps the capture when the tab is removed and mounted again, and releases the charts', async () => {
    tab.remove();
    await flush();
    expect(plots.filter((p) => !p.destroyed)).toHaveLength(0);
    const again = document.createElement('tessera-motion-diag-tab') as TabEl;
    again.api = api;
    again.params = {};
    document.body.append(again);
    await settle(again);
    const panel = again.shadowRoot!.querySelector('tessera-md-graphs-panel')!.shadowRoot!;
    expect(panel.textContent).toContain(text('motiondiag.graphs.title'));
    again.remove();
  });
});
