import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { availableFuncs, captureInfo, defaultNode, FUNCS, nodeToName, parseName } from '../core/catalog';
import { lowerBound, thinRange } from '../core/decimate';
import { describeDatasets, generateDatasets } from '../core/engine';
import { assignAxes } from '../core/graph-model';
import { availablePresets } from '../core/presets';
import { MotanError } from '../core/types';
import { loadMotanLog } from './helpers/motan-log';

const cartesian = loadMotanLog(fileURLToPath(new URL('./fixtures/cartesian/log', import.meta.url)));
const corexy = loadMotanLog(fileURLToPath(new URL('./fixtures/corexy/log', import.meta.url)));
const info = captureInfo(cartesian);

const goldenColumns = (dir: string): string[] =>
  (
    JSON.parse(readFileSync(new URL(`./fixtures/${dir}/cases.json`, import.meta.url), 'utf8')) as {
      cases: Array<{ columns: string[] }>;
    }
  ).cases.flatMap((c) => c.columns);

describe('captureInfo', () => {
  it('reads subscriptions, kinematics and numeric status fields', () => {
    expect(info.subscriptions).toContain('trapq:toolhead');
    expect(info.kinematics).toBe('cartesian');
    expect(info.statusFields).toContain('extruder.temperature');
    expect(info.statusFields).toContain('toolhead.max_velocity');
    // strings are not plottable
    expect(info.statusFields).not.toContain('toolhead.homed_axes');
    expect(captureInfo(corexy).kinematics).toBe('corexy');
  });
});

describe('dataset catalog', () => {
  it('turns every motan name used by the golden cases into a node and back', () => {
    for (const dir of ['cartesian', 'corexy']) {
      const i = captureInfo(dir === 'cartesian' ? cartesian : corexy);
      for (const name of new Set(goldenColumns(dir))) {
        expect(nodeToName(parseName(name, i), i), name).toBe(name);
      }
    }
  });

  it('offers only what the capture contains', () => {
    const fns = availableFuncs(info).map((f) => f.fn);
    for (const fn of ['trapq', 'stepq', 'accelerometer', 'angle', 'ldc1612', 'loadcell', 'stallguard', 'step_phase', 'status', 'kin', 'sos']) {
      expect(fns).toContain(fn);
    }
    const bare = captureInfo({ ...cartesian, subscriptions: new Set(['trapq:toolhead']) });
    const bareFns = availableFuncs(bare).map((f) => f.fn);
    expect(bareFns).toContain('trapq');
    expect(bareFns).not.toContain('accelerometer');
    expect(bareFns).not.toContain('stepq');
    expect(bareFns).not.toContain('step_phase');
  });

  it('hides kin for kinematics motan cannot handle', () => {
    const delta = { ...info, kinematics: 'delta' };
    expect(availableFuncs(delta).map((f) => f.fn)).not.toContain('kin');
  });

  it('builds a working default for every available function', async () => {
    const names = availableFuncs(info).map((f) => nodeToName(defaultNode(f.fn, info), info));
    const labels = describeDatasets(cartesian, names);
    for (const n of names) expect(labels.get(n), n).not.toBeInstanceOf(MotanError);
    const out = await generateDatasets(cartesian, names, { segmentTime: 0.002, skip: 0, duration: 1 });
    expect(out.series.size).toBe(new Set(names).size);
  });

  it('changes the parameters of sos with the filter type', () => {
    const node = defaultNode('sos', info);
    const keys = (n: typeof node) =>
      FUNCS.find((f) => f.fn === 'sos')!
        .params(n.args, info)
        .map((p) => p.key);
    expect(keys(node)).toEqual(['source', 'mode', 'type', 'a', 'b']);
    node.args.type = 'bandpass';
    node.args.source = parseName('accelerometer(hotend,x)', info);
    expect(keys(node)).toEqual(['source', 'mode', 'type', 'a', 'b', 'c']);
    expect(nodeToName({ ...node, args: { ...node.args, a: '2', b: '20', c: '100' } }, info)).toBe(
      'sos(accelerometer(hotend,x),filtfilt,bandpass,2,20,100)',
    );
  });

  it('drops empty trailing optionals and refuses a gap', () => {
    const n = defaultNode('stepq', info);
    expect(nodeToName(n, info)).toBe('stepq(stepper_x)');
    n.args.smooth = '0.02';
    expect(nodeToName(n, info)).toBe('stepq(stepper_x,0.02)');
    const l = defaultNode('loadcell', info);
    expect(nodeToName(l, info)).toBe('loadcell(lc)');
    l.args.what = 'counts';
    expect(nodeToName(l, info)).toBe('loadcell(lc,counts)');
  });

  it('refuses values that would break the notation, and missing required ones', () => {
    const n = defaultNode('status', info);
    n.args.field = 'a,b';
    expect(() => nodeToName(n, info)).toThrow(/cannot be used/);
    n.args.field = '';
    expect(() => nodeToName(n, info)).toThrow(/required/);
  });

  it('rejects unknown names', () => {
    expect(() => parseName('nothing(x)', info)).toThrow(/Unknown dataset/);
    expect(() => parseName('derivative(a,b)', info)).toThrow();
  });
});

describe('presets', () => {
  it('only offers presets the capture supports', () => {
    const ids = availablePresets(info).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['motion', 'stepper-deviation', 'accelerometer', 'loadcell', 'stallguard', 'phase']));
    const bare = captureInfo({ ...cartesian, subscriptions: new Set(['loadcell:lc']) });
    expect(availablePresets(bare).map((p) => p.id)).toEqual(['loadcell']);
  });

  it('builds graphs whose datasets all resolve on the capture', async () => {
    for (const cap of [cartesian, corexy]) {
      const i = captureInfo(cap);
      for (const preset of availablePresets(i)) {
        const rows = preset.build(i).rows;
        expect(rows.length, preset.id).toBeGreaterThan(0);
        const names = rows.flatMap((r) => r.series.map((s) => s.name));
        const labels = describeDatasets(cap, names, 0.002);
        for (const n of names) expect(labels.get(n), `${preset.id}: ${n}`).not.toBeInstanceOf(MotanError);
        await generateDatasets(cap, names, { segmentTime: 0.002, skip: 0, duration: 0.5 });
      }
    }
  });
});

describe('axes (motan twin axis rule)', () => {
  const l = (units: string) => ({ label: units, units });
  it('puts the first units on the left and the first other units on the right', () => {
    expect(assignAxes([l('A'), l('B'), l('A'), l('B')])).toEqual({
      sides: ['left', 'right', 'left', 'right'],
      left: 'A',
      right: 'B',
    });
  });
  it('falls back to an "Unknown" left axis for a third kind', () => {
    expect(assignAxes([l('A'), l('B'), l('C')])).toEqual({ sides: ['left', 'right', 'left'], left: 'Unknown', right: 'B' });
  });
  it('handles an empty row', () => {
    expect(assignAxes([])).toEqual({ sides: [], left: '', right: null });
  });
});

describe('thinning for drawing', () => {
  const n = 100_000;
  const x = Float64Array.from({ length: n }, (_, i) => i / 1000);
  const y = Float64Array.from({ length: n }, (_, i) => Math.sin(i / 300));
  const spike = Float64Array.from(y);
  spike[43_210] = 50;
  spike[77_001] = -50;

  it('returns short ranges untouched', () => {
    const t = thinRange(x, [y], 10, 11, 4000);
    expect(t.x.length).toBeLessThan(4000);
    expect(t.x[0]).toBeLessThanOrEqual(10);
    expect(t.x.at(-1)).toBeGreaterThanOrEqual(11);
  });

  it('keeps spikes and stays sorted', () => {
    const t = thinRange(x, [spike], 0, 100, 2000);
    expect(t.x.length).toBeLessThanOrEqual(2000);
    expect(Math.max(...t.y[0]!)).toBe(50);
    expect(Math.min(...t.y[0]!)).toBe(-50);
    for (let i = 1; i < t.x.length; i++) expect(t.x[i]! >= t.x[i - 1]!).toBe(true);
  });

  it('keeps a gap as a gap', () => {
    const gap = Float64Array.from(y);
    gap.fill(Number.NaN, 20_000, 30_000);
    const t = thinRange(x, [gap], 0, 100, 2000);
    expect(t.y[0]!.some(Number.isNaN)).toBe(true);
  });

  it('thins only the visible range', () => {
    const t = thinRange(x, [y], 50, 60, 2000);
    expect(t.x[0]).toBeGreaterThanOrEqual(49.9);
    expect(t.x.at(-1)).toBeLessThanOrEqual(60.1);
  });

  it('finds the lower bound', () => {
    expect(lowerBound(x, 12.3456)).toBe(12346);
    expect(lowerBound(x, -1)).toBe(0);
    expect(lowerBound(x, 1e9)).toBe(n);
  });
});
