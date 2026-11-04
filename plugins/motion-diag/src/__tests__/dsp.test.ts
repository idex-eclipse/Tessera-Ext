import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { butterSos, notchSos, sosfilt, sosfiltfilt, sosfiltZi, type BandType, type Sos } from '../core/dsp';

interface DspCase {
  kind: 'butter' | 'notch';
  btype?: BandType;
  order?: number;
  cutoff?: number | [number, number];
  freq?: number;
  quality?: number;
  fs: number;
  sos: Sos;
  filt: number[];
  filtfilt: number[];
}

const fixture = JSON.parse(readFileSync(new URL('./fixtures/dsp.json', import.meta.url), 'utf8')) as {
  x: number[];
  cases: DspCase[];
};

function expectClose(actual: ArrayLike<number>, expected: number[], tol: number, what: string): void {
  expect(actual.length, what).toBe(expected.length);
  let worst = 0;
  for (let i = 0; i < expected.length; i++) {
    const err = Math.abs(actual[i]! - expected[i]!) / Math.max(1, Math.abs(expected[i]!));
    worst = Math.max(worst, err);
  }
  expect(worst, `${what}: worst relative error`).toBeLessThan(tol);
}

describe('scipy.signal port', () => {
  for (const [i, tc] of fixture.cases.entries()) {
    const title =
      tc.kind === 'butter'
        ? `butter ${tc.btype} order ${tc.order} cutoff ${JSON.stringify(tc.cutoff)} fs ${tc.fs}`
        : `iirnotch ${tc.freq} Hz Q ${tc.quality} fs ${tc.fs}`;
    it(`#${i} ${title}`, () => {
      const sos =
        tc.kind === 'butter'
          ? butterSos(tc.order!, tc.cutoff!, tc.btype!, tc.fs)
          : notchSos(tc.freq!, tc.quality!, tc.fs);
      // Same section count and layout as scipy (sosfiltfilt's padding depends on it).
      expect(sos.length).toBe(tc.sos.length);
      for (let s = 0; s < sos.length; s++) expectClose(sos[s]!, tc.sos[s]!, 1e-9, `section ${s}`);

      const zi = sosfiltZi(sos).map(([a, b]) => [a * fixture.x[0]!, b * fixture.x[0]!] as [number, number]);
      expectClose(sosfilt(sos, fixture.x, zi), tc.filt, 1e-8, 'sosfilt');
      expectClose(sosfiltfilt(sos, fixture.x), tc.filtfilt, 1e-8, 'sosfiltfilt');
    });
  }

  it('refuses an input that is not longer than the padding', () => {
    expect(() => sosfiltfilt(butterSos(2, 60, 'lowpass', 500), [1, 2, 3])).toThrow(/padlen/);
  });

  it('refuses a cutoff at or above Nyquist', () => {
    expect(() => butterSos(2, 250, 'lowpass', 500)).toThrow(/fs\/2/);
  });
});
