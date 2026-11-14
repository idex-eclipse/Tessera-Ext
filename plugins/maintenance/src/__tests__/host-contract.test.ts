// @vitest-environment happy-dom
/**
 * Plays the host's role against the real plugin module:
 * - checks the tags, the extension point, the widget and the dictionaries manifest.json
 *   refers to;
 * - mounts the tab like PluginElementHost (createElement(tag) -> el.api / el.params ->
 *   append) and drives it: wizard, cards, pressing a result, the widget.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { defaultAnswers } from '../core/presets';
import type { MoonrakerLike } from '../core/runtime';
import type { PluginApi } from '../sdk';

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
    get: <T,>(k: string) => data[k] as T | undefined,
    set: (k: string, v: unknown) => {
      data[k] = JSON.parse(JSON.stringify(v));
      listeners.forEach((l) => l(k, v));
    },
    onChange: (cb: (k: string, v: unknown) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

const moonraker: MoonrakerLike = {
  request: (async (method: string) => {
    if (method === 'printer.objects.list') return { objects: ['extruder'] };
    if (method === 'server.history.totals') return { job_totals: { total_jobs: 0, total_print_time: 0, total_filament_used: 0 } };
    throw new Error(method);
  }) as MoonrakerLike['request'],
  subscribe: () => () => {},
  onNotify: () => () => {},
  onReady: () => () => {},
};

let mod: typeof import('../index');
let strings: Record<string, string>;
let api: PluginApi;
const printer = { id: 'p1', name: 'Voron', url: 'http://printer' };

beforeAll(async () => {
  mod = await import('../index');
  strings = flat(mod.locales.en as Dict);
  const settings = fakeSettings();
  api = {
    pluginId: 'tessera/maintenance',
    printer,
    printers: [printer],
    moonrakerFor: () => moonraker,
    settingsFor: () => settings,
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

type El = HTMLElement & { api: PluginApi; params: unknown; updateComplete: Promise<boolean> };

async function settle(el: HTMLElement): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await flush();
    await (el as El).updateComplete;
    for (const child of deepAll(el, '*')) if ('updateComplete' in child) await (child as El).updateComplete;
  }
}

/** Every element matching `selector` in the element's shadow tree and the shadow trees below it. */
function deepAll<T extends Element>(root: Element | ShadowRoot, selector: string): T[] {
  const out: T[] = [];
  const walk = (node: Element | ShadowRoot): void => {
    const scope = node instanceof ShadowRoot ? node : (node.shadowRoot ?? node);
    for (const m of scope.querySelectorAll<T>(selector)) out.push(m);
    for (const child of scope.querySelectorAll('*')) if (child.shadowRoot) walk(child.shadowRoot);
  };
  walk(root instanceof Element && root.shadowRoot ? root.shadowRoot : root);
  return out;
}

const text = (el: Element): string => deepAll(el, '*').map((n) => n.textContent ?? '').join(' ');

function mount(tag: string): El {
  // like PluginElementHost: create by tag, hand over the plugin's own api, append
  const el = document.createElement(tag) as El;
  el.api = api;
  el.params = {};
  document.body.append(el);
  return el;
}

describe('host contract', () => {
  it('registers the elements, the point, the widget and the dictionaries manifest.json names', async () => {
    const manifest = (await import('../../manifest.json')).default;
    expect(manifest.extensions).toHaveLength(1);
    const e = manifest.extensions[0]!;
    expect(customElements.get(e.element)).toBeDefined();
    expect(e).toMatchObject({ point: '@core/system#tabs', kind: 'tab', version: 1 });
    expect(manifest.dependencies).toEqual({ '@core/system': '4.0.0' });
    expect(manifest.pluginApi).toBe('1.0');
    expect(Object.keys(mod.locales)).toEqual(manifest.locales);
    expect(strings[e.titleKey]).toBeTruthy();
    expect(manifest.overlays).toHaveLength(1);
    expect(customElements.get(manifest.overlays[0]!.element)).toBeDefined();
    const guard = manifest.guards[0]!;
    expect(guard.match).toEqual(['printer.print.start', 'server.job_queue.start']);
    expect(typeof (mod as Record<string, unknown>)[guard.handler]).toBe('function');
    const w = manifest.widgets[0]!;
    expect(customElements.get(w.element)).toBeDefined();
    expect(strings[w.titleKey]).toBeTruthy();
  });

  it('keeps en and ru in sync, placeholders included', () => {
    const ru = flat(mod.locales.ru as Dict);
    expect(Object.keys(ru).sort()).toEqual(Object.keys(strings).sort());
    for (const [key, v] of Object.entries(ru)) {
      expect([...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key).toEqual(
        [...strings[key]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
      );
    }
  });

  it('has every key the source uses, including the ones built from a value', () => {
    const srcDir = resolve(process.cwd(), 'src') + '/';
    const files = [
      ...readdirSync(srcDir + 'core').map((f) => `core/${f}`),
      ...readdirSync(srcDir + 'ui').map((f) => `ui/${f}`),
      'hub.ts',
      'monitor.ts',
      'queue.ts',
    ];
    const missing: string[] = [];
    for (const f of files) {
      const code = readFileSync(srcDir + f, 'utf8');
      for (const m of code.matchAll(/'(maintenance\.[\w.-]+)'/g)) if (!(m[1]! in strings)) missing.push(`${f}: ${m[1]}`);
    }
    // keys assembled at run time: every built-in task, outcome, rail type, unit, status, link and wizard choice
    const built = [
      ...['bed-check', 'bed-wash', 'lube-axes', 'rails-clean', 'belts', 'shaper-calib', 'nozzle', 'zoffset', 'hot-tighten', 'feeder-lube'].map((d) => `maintenance.task.${d}.why`),
      ...['bed-check', 'bed-wash', 'lube-axes', 'rails-clean', 'belts', 'shaper-calib', 'nozzle', 'zoffset', 'hot-tighten', 'feeder-lube', 'custom'].map((d) => `maintenance.task.${d}.name`),
      ...['done', 'checked', 'adjusted', 'replaced'].map((o) => `maintenance.outcome.${o}`),
      ...['ball-liquid', 'ball-grease', 'carbon', 'none'].map((r) => `maintenance.rail.${r}`),
      ...['hours', 'prints', 'days', 'filamentKm'].flatMap((u) => [`maintenance.unit.${u}`, `maintenance.unitName.${u}`]),
      ...['ok', 'soon', 'overdue', 'off'].map((s) => `maintenance.status.${s}`),
      ...['belts', 'shaper', 'probe', 'heaters', 'mesh'].map((l) => `maintenance.link.${l}`),
      ...['brass', 'hardened', 'custom'].map((n) => `maintenance.wizard.nozzle.${n}`),
      ...['regular', 'planetary'].map((f) => `maintenance.wizard.feeder.${f}`),
      ...['x', 'y', 'z'].map((a) => `maintenance.wizard.axis.${a}`),
      ...['tasks', 'chains', 'journal', 'settings'].map((s) => `maintenance.nav.${s}`),
      ...['soon', 'overdue', 'triggered'].map((n) => `maintenance.notify.${n}`),
      'maintenance.journalEvent.startedAnyway',
    ];
    for (const k of built) if (!(k in strings)) missing.push(`built: ${k}`);
    expect(missing).toEqual([]);
  });

  it('every built-in task the defaults create has a name and an explanation', async () => {
    const { createDefaultState } = await import('../core/defaults');
    const state = createDefaultState(['extruder'], { printSeconds: 0, jobs: 0, filamentMm: 0 }, 0);
    for (const t of state.tasks) {
      expect(strings[`maintenance.task.${t.defId}.name`], t.defId).toBeTruthy();
      expect(strings[`maintenance.task.${t.defId}.why`], t.defId).toBeTruthy();
      for (const o of t.outcomes) expect(strings[o.labelKey!], o.id).toBeTruthy();
    }
  });
});

describe('the tab', () => {
  it('shows the wizard first, then the task cards after "Apply"', async () => {
    const tab = mount('tessera-maintenance-tab');
    await settle(tab);
    expect(deepAll(tab, 'tessera-maint-wizard')).toHaveLength(1);
    expect(deepAll(tab, 'tessera-maint-card')).toHaveLength(0);

    const apply = deepAll<HTMLButtonElement>(tab, 'button').find((b) => b.textContent?.trim() === strings['maintenance.wizard.finish'])!;
    apply.click();
    await settle(tab);
    expect(deepAll(tab, 'tessera-maint-wizard')).toHaveLength(0);
    expect(deepAll(tab, 'tessera-maint-card').length).toBeGreaterThan(3);
    tab.remove();
  });

  it('pressing "Adjusted" on the belts card makes the shaper calibration card appear', async () => {
    const tab = mount('tessera-maintenance-tab');
    await settle(tab);
    const cardTitles = () => deepAll(tab, '.panel-title').map((n) => n.textContent?.trim());
    expect(cardTitles()).not.toContain(strings['maintenance.task.shaper-calib.name']);

    const belts = deepAll<HTMLElement>(tab, 'tessera-maint-card').find((c) => text(c).includes(strings['maintenance.task.belts.name']!))!;
    const adjusted = deepAll<HTMLButtonElement>(belts, 'button').find((b) => b.textContent?.trim() === strings['maintenance.outcome.adjusted'])!;
    adjusted.click();
    await settle(tab);
    const confirm = deepAll<HTMLButtonElement>(belts, 'button').find((b) => b.textContent?.includes(strings['maintenance.common.confirm']!))!;
    confirm.click();
    await settle(tab);

    expect(cardTitles()).toContain(strings['maintenance.task.shaper-calib.name']);
    expect(text(tab)).toContain(strings['maintenance.task.shaper-calib.name']);
    tab.remove();
  });

  it('the settings section lists the switches', async () => {
    const tab = mount('tessera-maintenance-tab');
    await settle(tab);
    deepAll<HTMLButtonElement>(tab, 'button').find((b) => b.textContent?.trim() === strings['maintenance.nav.settings'])!.click();
    await settle(tab);
    expect(text(tab)).toContain(strings['maintenance.settings.notifications']);
    expect(deepAll(tab, 'input[type="checkbox"]').length).toBeGreaterThanOrEqual(3);
    tab.remove();
  });
});

describe('the widget', () => {
  it('summarizes what is due and links to the tab', async () => {
    const w = mount('tessera-maintenance-widget');
    await settle(w);
    const link = deepAll<HTMLAnchorElement>(w, 'a')[0]!;
    expect(link.getAttribute('href')).toBe('#/p/p1/machine?section=tessera%2Fmaintenance%2Fmaintenance');
    // a shaper calibration was requested in the previous test, so something is due
    expect(text(w)).toContain(strings['maintenance.task.shaper-calib.name']);
    w.remove();
  });
});

void defaultAnswers;
