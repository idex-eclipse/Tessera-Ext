import { beforeEach, describe, expect, it, vi } from 'vitest';

import { binSamples, parseForceBatch } from '../force-parse';
import { startForceSource } from '../force-source';
import { configFromSettings, loadCellName, pickLoadCell } from '../printer-config';
import {
  _resetAll,
  appendLines,
  beginRun,
  endRun,
  expireStale,
  getState,
  restoreFromHistory,
} from '../run-store';
import { SeriesBuffer } from '../series-buffer';
import type { MoonrakerProxyHandle } from '../sdk';

describe('printer config', () => {
  const settings = {
    pa_tester: { method: 'step_response', high_flow: 12, force_sensor: undefined },
    'load_cell foo': {},
    load_cell_probe: {},
    extruder: {},
    extruder1: {},
    printer: {},
  };

  it('reads the section, load cells and extruders', () => {
    const c = configFromSettings(settings);
    expect(c.hasPaTester).toBe(true);
    expect(c.options).toEqual({ method: 'step_response', high_flow: '12' });
    expect(c.loadCells).toEqual([
      { section: 'load_cell foo', name: 'foo' },
      { section: 'load_cell_probe', name: 'load_cell_probe' },
    ]);
    expect(c.extruders).toEqual(['extruder', 'extruder1']);
    expect(configFromSettings({ printer: {} }).hasPaTester).toBe(false);
  });

  it('names the webhook after the last word of the section', () => {
    expect(loadCellName('load_cell')).toBe('load_cell');
    expect(loadCellName('load_cell foo')).toBe('foo');
  });

  it('picks the cell: choice, then force_sensor, then the only one', () => {
    const two = configFromSettings(settings);
    expect(pickLoadCell(two)).toBeNull();
    expect(pickLoadCell(two, 'load_cell foo')?.name).toBe('foo');

    const one = configFromSettings({ pa_tester: {}, load_cell: {} });
    expect(pickLoadCell(one)?.section).toBe('load_cell');

    const named = configFromSettings({ pa_tester: { force_sensor: 'load_cell bar' }, 'load_cell bar': {}, load_cell: {} });
    expect(pickLoadCell(named)?.section).toBe('load_cell bar');
    expect(pickLoadCell(configFromSettings({ pa_tester: {} }))).toBeNull();
  });
});

describe('run store', () => {
  beforeEach(() => _resetAll());

  it('our run collects the log and ends with the parsed result', () => {
    beginRun('p');
    appendLines('p', ['// PA calibration results:', '//   flow= 2.00  pressure_advance=0.040', '//   overall pressure_advance=0.040']);
    expect(getState('p').result.overall).toBe(0.04);
    endRun('p');
    expect(getState('p').busy).toBe(false);
    expect(getState('p').result.running).toBe(false);
  });

  it('a request error is appended as a "!!" line', () => {
    beginRun('p');
    endRun('p', 'Extruder cannot extrude');
    expect(getState('p').result.error).toBe('Extruder cannot extrude');
  });

  it('console noise is not collected; a run started elsewhere is', () => {
    appendLines('p', ['// ok', 'T:200']);
    expect(getState('p').lines).toEqual([]);

    appendLines('p', ['// Detected extrude_force_sign=1', '// PA calibration results:']);
    expect(getState('p').external).toBe(true);
    expect(getState('p').result.running).toBe(true);

    appendLines('p', ['//   overall pressure_advance=0.05']);
    expect(getState('p').external).toBe(false);
    expect(getState('p').result.overall).toBe(0.05);

    appendLines('p', ['// ok again']);
    expect(getState('p').lines).toHaveLength(3);
  });

  it('restores the last run from the console history', () => {
    restoreFromHistory(
      'p',
      [
        { message: 'G28', time: 1 },
        { message: 'TEST_PRESSURE_ADVANCE METHOD=search_overshoot', time: 100 },
        { message: '// Searching for optimal pressure_advance...\n// Tested pressure_advance=0.1 -> overshoot', time: 101 },
      ],
      120,
    );
    const s = getState('p');
    expect(s.restored).toBe(true);
    expect(s.result.method).toBe('search_overshoot');
    expect(s.result.running).toBe(true);
    expect(s.external).toBe(true);
    expect(s.result.search).toHaveLength(1);
  });

  it('a run that never ended is not shown as running forever', () => {
    restoreFromHistory('p', [{ message: 'PA_CALIBRATE', time: 100 }], 100 + 3600);
    expect(getState('p').result.running).toBe(false);

    _resetAll();
    restoreFromHistory('p', [{ message: 'PA_CALIBRATE', time: 100 }], 110);
    expect(getState('p').result.running).toBe(true);
    expireStale('p', 110 + 11 * 60);
    expect(getState('p').result.running).toBe(false);
  });
});

describe('series buffer', () => {
  it('keeps the time window and the point cap', () => {
    const b = new SeriesBuffer(10, 5);
    for (let t = 0; t < 30; t++) b.push(t, t * 2);
    expect(b.length).toBe(5);
    expect(b.times()).toEqual([25, 26, 27, 28, 29]);
    expect(b.last()).toEqual({ time: 29, value: 58 });
    expect(b.range()).toEqual({ min: 50, max: 58 });

    const w = new SeriesBuffer(10, 1000);
    for (let t = 0; t < 30; t++) w.push(t, 1);
    expect(w.times()[0]).toBe(19);
    w.clear();
    expect(w.length).toBe(0);
    expect(w.range()).toBeNull();
    expect(w.last()).toBeNull();
  });

  it('compacts the dead prefix without losing points', () => {
    const b = new SeriesBuffer(5, 100000);
    for (let t = 0; t < 5000; t += 0.01) b.push(t, t);
    expect(b.length).toBeLessThanOrEqual(501);
    expect(b.times().at(-1)).toBeCloseTo(4999.99, 1);
  });
});

describe('force stream parsing', () => {
  it('reads grams when every row has them', () => {
    expect(parseForceBatch({ data: [[1, 10.5, 1000, 900], [2, 11, 1010, 900]] })).toEqual({
      unit: 'g',
      samples: [{ time: 1, value: 10.5 }, { time: 2, value: 11 }],
    });
  });

  it('falls back to counts − tare for an uncalibrated cell', () => {
    expect(parseForceBatch({ data: [[1, null, 1000, 900], [2, null, 1010, null]] })).toEqual({
      unit: 'counts',
      samples: [{ time: 1, value: 100 }, { time: 2, value: 1010 }],
    });
  });

  it('survives garbage', () => {
    expect(parseForceBatch(null).samples).toEqual([]);
    expect(parseForceBatch({ data: 'x' }).samples).toEqual([]);
    expect(parseForceBatch({ data: [null, [], ['a', 1], [3, 5, 0, 0]] }).samples).toEqual([{ time: 3, value: 5 }]);
  });

  it('bins fast samples into averages', () => {
    const samples = Array.from({ length: 10 }, (_, i) => ({ time: i * 0.005, value: i }));
    const out = binSamples(samples, 0.02);
    expect(out.length).toBeLessThan(samples.length);
    expect(out.reduce((s, x) => s + x.value, 0) / out.length).toBeGreaterThan(0);
    expect(binSamples(samples, 0)).toHaveLength(10);
    expect(binSamples([], 0.02)).toEqual([]);
  });
});

describe('force source', () => {
  const cell = { section: 'load_cell foo', name: 'foo' };

  function handleWith(extra: Partial<MoonrakerProxyHandle>): MoonrakerProxyHandle {
    return extra as MoonrakerProxyHandle;
  }

  it('uses the host stream and releases it on stop', () => {
    let onData: (d: unknown) => void = () => {};
    let onStatus: (s: 'connecting' | 'live' | 'unavailable') => void = () => {};
    const unreg = vi.fn();
    const klippyStream = vi.fn((_m: string, _p: unknown, d: (x: unknown) => void, s?: typeof onStatus) => {
      onData = d;
      onStatus = s!;
      return unreg;
    });
    const sink = { onSamples: vi.fn(), onSource: vi.fn() };
    const stop = startForceSource(handleWith({ klippyStream }), cell, sink);

    expect(klippyStream).toHaveBeenCalledWith('load_cell/dump_force', { load_cell: 'foo' }, expect.any(Function), expect.any(Function));
    onStatus('live');
    expect(sink.onSource).toHaveBeenLastCalledWith('stream', 'live');
    onData({ data: [[1, 5, 0, 0]] });
    expect(sink.onSamples).toHaveBeenCalledWith([{ time: 1, value: 5 }], 'g');

    stop();
    expect(unreg).toHaveBeenCalledTimes(1);
  });

  it('falls back to the status subscription when the bridge is unavailable, and back', () => {
    let onStatus: (s: 'connecting' | 'live' | 'unavailable') => void = () => {};
    let statusCb: (d: unknown) => void = () => {};
    const unsub = vi.fn();
    const subscribe = vi.fn((_o: unknown, cb: (d: unknown) => void) => {
      statusCb = cb;
      return unsub;
    });
    const klippyStream = vi.fn((_m: string, _p: unknown, _d: unknown, s?: typeof onStatus) => {
      onStatus = s!;
      return () => {};
    });
    const sink = { onSamples: vi.fn(), onSource: vi.fn() };
    startForceSource(handleWith({ klippyStream, subscribe }), cell, sink, () => 42);

    onStatus('unavailable');
    expect(subscribe).toHaveBeenCalledWith({ 'load_cell foo': ['force_g'] }, expect.any(Function), { immediate: true });
    statusCb({ 'load_cell foo': { force_g: 3.5 } });
    expect(sink.onSource).toHaveBeenLastCalledWith('status', 'live');
    expect(sink.onSamples).toHaveBeenLastCalledWith([{ time: 42, value: 3.5 }], 'g');
    statusCb({ 'load_cell foo': {} });
    expect(sink.onSamples).toHaveBeenCalledTimes(1);

    onStatus('live'); // the bridge came back
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(sink.onSource).toHaveBeenLastCalledWith('stream', 'live');
  });

  it('an older host without klippyStream uses the status subscription at once', () => {
    const unsub = vi.fn();
    const subscribe = vi.fn(() => unsub);
    const sink = { onSamples: vi.fn(), onSource: vi.fn() };
    const stop = startForceSource(handleWith({ subscribe }), cell, sink);
    expect(subscribe).toHaveBeenCalledTimes(1);
    stop();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
