import { describe, expect, it } from 'vitest';

import { composePng, wrapLegend, type PngRow } from '../ui/png';

/** A recording 2D context: the picture cannot be rendered in Node, but what is drawn where can be checked. */
function fakeCanvas() {
  const calls: Array<[string, ...unknown[]]> = [];
  const made: Array<{ w: number; h: number }> = [];
  const ctx = new Proxy(
    { measureText: (t: string) => ({ width: t.length * 6 }) },
    {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return (...args: unknown[]) => void calls.push([prop, ...args]);
      },
      set(_t, prop: string, value) {
        calls.push([`set ${prop}`, value]);
        return true;
      },
    },
  );
  const factory = (w: number, h: number) => {
    made.push({ w, h });
    return { width: w, height: h, getContext: () => ctx, toBlob: (cb: (b: Blob) => void) => cb(new Blob(['png'], { type: 'image/png' })) } as unknown as HTMLCanvasElement;
  };
  return { calls, made, factory };
}

const row = (title: string, labels: string[]): PngRow => ({
  title,
  canvas: { width: 1200, height: 520 } as PngRow['canvas'],
  cssWidth: 600,
  cssHeight: 260,
  legend: labels.map((label, i) => ({ color: `rgb(${i}, 0, 0)`, label })),
});

const base = { title: 'T', subtitle: 'S', pxRatio: 2, colors: { background: '#fff', text: '#111', muted: '#888' }, fontFamily: 'sans-serif' };

describe('legend wrapping', () => {
  it('keeps items on a line while they fit and starts a new line when they do not', () => {
    const items = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'].map((label) => ({ color: 'red', label }));
    // each item: swatch 12 + 6 + 60 = 78, plus a 16 gap
    const lines = wrapLegend(items, 200, (t) => t.length * 6);
    expect(lines.map((l) => l.map((i) => i.item.label))).toEqual([['aaaaaaaaaa', 'bbbbbbbbbb'], ['cccccccccc']]);
    expect(lines[0]![1]!.x).toBe(78 + 16);
  });

  it('never leaves a line empty because of one very long item', () => {
    const lines = wrapLegend([{ color: 'red', label: 'x'.repeat(100) }], 50, (t) => t.length * 6);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveLength(1);
  });
});

describe('composePng', () => {
  it('draws the background, the titles, every chart and its legend at the charts\' pixel ratio', async () => {
    const f = fakeCanvas();
    const blob = await composePng({ ...base, rows: [row('Graph 1', ['velocity']), row('Graph 2', ['a', 'b'])], createCanvas: f.factory });
    expect(blob.type).toBe('image/png');

    // the real canvas is twice the CSS size of the layout
    const final = f.made.at(-1)!;
    expect(final.w).toBe((600 + 32) * 2);
    expect(final.h % 2).toBe(0);

    const fills = f.calls.filter((c) => c[0] === 'fillRect');
    expect(fills[0]).toEqual(['fillRect', 0, 0, 632, final.h / 2]); // background over the whole picture
    expect(f.calls.some((c) => c[0] === 'scale' && c[1] === 2)).toBe(true);

    const texts = f.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
    expect(texts).toEqual(['T', 'S', 'Graph 1', 'velocity', 'Graph 2', 'a', 'b']);

    const images = f.calls.filter((c) => c[0] === 'drawImage');
    expect(images).toHaveLength(2);
    // drawn at CSS size, the second one below the first
    expect(images[0]!.slice(2, 5)).toEqual([16, expect.any(Number), 600]);
    expect(images[1]![3] as number).toBeGreaterThan((images[0]![3] as number) + 260);
  });

  it('wraps a long legend so the picture grows instead of cutting it', async () => {
    const few = fakeCanvas();
    await composePng({ ...base, rows: [row('G', ['one'])], createCanvas: few.factory });
    const many = fakeCanvas();
    const labels = Array.from({ length: 12 }, (_, i) => `series number ${i}`);
    await composePng({ ...base, rows: [row('G', labels)], createCanvas: many.factory });
    expect(many.made.at(-1)!.h).toBeGreaterThan(few.made.at(-1)!.h);
  });

  it('refuses to make an empty picture', async () => {
    await expect(composePng({ ...base, rows: [] })).rejects.toThrow(/Nothing/);
  });
});
