import { describe, expect, it, vi } from 'vitest';
import { MainsFilter, mainsFilterSeries, parseMainsHz } from '../mains-filter';
import { startForceSource } from '../force-source';

/** 1 kHz samples of `dc` plus a sine of `hz` and amplitude `amp`. */
function hum(hz: number, seconds: number, dc = 5, amp = 3, rate = 1000) {
  const out: Array<{ time: number; value: number }> = [];
  for (let i = 0; i < seconds * rate; i++) {
    const time = i / rate;
    out.push({ time, value: dc + amp * Math.sin(2 * Math.PI * hz * time) });
  }
  return out;
}

/** Peak deviation from the DC level after the first period (the warm-up). */
function residual(samples: Array<{ time: number; value: number }>, dc = 5): number {
  return Math.max(...samples.filter((s) => s.time > 0.05).map((s) => Math.abs(s.value - dc)));
}

describe('mains filter', () => {
  it('parses the frequency, defaulting to 50 Hz', () => {
    expect(parseMainsHz(60)).toBe(60);
    expect(parseMainsHz(50)).toBe(50);
    expect(parseMainsHz('x')).toBe(50);
  });

  it('removes 50 Hz hum and keeps the DC level', () => {
    const f = new MainsFilter(50);
    expect(residual(f.process(hum(50, 0.5)))).toBeLessThan(0.01);
    expect(f.active).toBe(true);
  });

  it('removes 60 Hz hum with the 60 Hz setting but not with the 50 Hz one', () => {
    expect(residual(new MainsFilter(60).process(hum(60, 0.5)))).toBeLessThan(0.3);
    expect(residual(new MainsFilter(50).process(hum(60, 0.5)))).toBeGreaterThan(0.3);
  });

  it('removes harmonics too', () => {
    expect(residual(new MainsFilter(50).process(hum(150, 0.5)))).toBeLessThan(0.01);
  });

  it('gives the same result for one batch and for many small ones', () => {
    const samples = hum(50, 0.3);
    const whole = new MainsFilter(50).process(samples);
    const f = new MainsFilter(50);
    const parts = [];
    for (let i = 0; i < samples.length; i += 7) parts.push(...f.process(samples.slice(i, i + 7)));
    expect(parts).toHaveLength(whole.length);
    parts.forEach((p, i) => expect(p.value).toBeCloseTo(whole[i]!.value, 9));
  });

  it('passes slow sensors through unchanged and says so', () => {
    const slow = hum(50, 2, 5, 3, 80);
    const f = new MainsFilter(50);
    expect(f.process(slow)).toEqual(slow);
    expect(f.active).toBe(false);
  });

  it('filters a whole series, returning the input itself when it cannot act', () => {
    const fast = hum(50, 0.3);
    const r = mainsFilterSeries(50, fast.map((s) => s.time), fast.map((s) => s.value));
    expect(r.active).toBe(true);
    expect(Math.max(...r.values.slice(60).map((v) => Math.abs(v - 5)))).toBeLessThan(0.01);

    const slowXs = [0, 0.0125, 0.025, 0.0375, 0.05];
    const slowYs = [1, 2, 3, 4, 5];
    const s = mainsFilterSeries(50, slowXs, slowYs);
    expect(s.active).toBe(false);
    expect(s.values).toBe(slowYs);
  });
});

describe('force source with the mains filter', () => {
  const probe = { section: 'load_cell foo', name: 'foo' };

  it('filters the stream before binning and follows the toggle', () => {
    let push: (d: unknown) => void = () => {};
    const klippyStream = vi.fn((_m: string, _p: unknown, onData: (d: unknown) => void) => {
      push = onData;
      return () => {};
    });
    // 60 Hz on purpose: the chart's own 20 ms bins already null a 50 Hz hum
    const rows = hum(60, 0.2).map((s) => [s.time, s.value, 0, 0]);
    const onSamples = vi.fn();
    const onMains = vi.fn();
    let hz: 0 | 60 = 60;
    startForceSource({ klippyStream } as never, probe, { onSamples, onSource: vi.fn(), onMains }, undefined, () => hz);

    push({ data: rows });
    const filtered = onSamples.mock.calls[0]![0] as Array<{ value: number }>;
    expect(Math.abs(filtered[filtered.length - 1]!.value - 5)).toBeLessThan(0.3);
    expect(onMains).toHaveBeenLastCalledWith(true);

    // off: the raw hum comes through
    hz = 0;
    onSamples.mockClear();
    push({ data: hum(60, 0.2).map((s) => [s.time + 1, s.value, 0, 0]) });
    const raw = (onSamples.mock.calls[0]![0] as Array<{ value: number }>).map((s) => s.value);
    expect(Math.max(...raw) - Math.min(...raw)).toBeGreaterThan(0.1);
  });
});
