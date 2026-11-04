/**
 * One PNG of all graphs: a title, and for each row its heading, the chart and its legend.
 *
 * uPlot draws the axes, tick labels, axis titles and the lines on its canvas, but the
 * legend is HTML and the canvas is transparent. So the picture is assembled here: a
 * background in the theme's color, then each chart canvas copied as it is on screen
 * (including a zoom), with a legend drawn under it.
 */

export interface PngLegendItem {
  color: string;
  label: string;
}

export interface PngRow {
  title: string;
  /** The chart's canvas, with its size in CSS pixels (the canvas itself is `pxRatio` times larger). */
  canvas: CanvasImageSource & { width: number; height: number };
  cssWidth: number;
  cssHeight: number;
  legend: PngLegendItem[];
}

export interface PngOptions {
  title: string;
  subtitle: string;
  rows: PngRow[];
  /** Device pixels per CSS pixel of the charts' canvases; the picture is made at the same scale. */
  pxRatio: number;
  colors: { background: string; text: string; muted: string };
  fontFamily: string;
  /** Test seam: the canvas factory. */
  createCanvas?: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;
}

const PAD = 16;
const GAP = 12;
const LEGEND_FONT = 12;
const LEGEND_LINE = 18;
const SWATCH = 12;

interface Placed {
  legendLines: Array<Array<{ item: PngLegendItem; x: number; width: number }>>;
}

/** Splits legend items over lines that fit `maxWidth` (CSS px), measuring with `measure`. */
export function wrapLegend(
  items: readonly PngLegendItem[],
  maxWidth: number,
  measure: (text: string) => number,
): Placed['legendLines'] {
  const lines: Placed['legendLines'] = [[]];
  let x = 0;
  for (const item of items) {
    const width = SWATCH + 6 + measure(item.label);
    if (x > 0 && x + width > maxWidth) {
      lines.push([]);
      x = 0;
    }
    lines[lines.length - 1]!.push({ item, x, width });
    x += width + 16;
  }
  return lines;
}

function makeCanvas(w: number, h: number, factory?: PngOptions['createCanvas']): HTMLCanvasElement | OffscreenCanvas {
  if (factory) return factory(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Assembles the picture and encodes it as PNG. Rejects when no row is given. */
export async function composePng(opts: PngOptions): Promise<Blob> {
  if (opts.rows.length === 0) throw new Error('Nothing to draw');
  const { pxRatio: r, colors } = opts;
  const width = Math.max(...opts.rows.map((row) => row.cssWidth)) + PAD * 2;

  // Measuring needs a context before the final size is known; a throw-away canvas does it.
  const probe = makeCanvas(1, 1, opts.createCanvas).getContext('2d') as CanvasRenderingContext2D;
  probe.font = `${LEGEND_FONT}px ${opts.fontFamily}`;
  const measure = (t: string): number => probe.measureText(t).width;

  const laidOut = opts.rows.map((row) => ({ row, lines: wrapLegend(row.legend, width - PAD * 2, measure) }));
  const headerHeight = PAD + 22 + 18 + GAP;
  const rowHeight = (row: PngRow, lines: number): number => 18 + row.cssHeight + lines * LEGEND_LINE + GAP;
  const height = headerHeight + laidOut.reduce((n, l) => n + rowHeight(l.row, l.lines.length), 0) + PAD;

  const canvas = makeCanvas(Math.round(width * r), Math.round(height * r), opts.createCanvas);
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(r, r);
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'top';

  ctx.fillStyle = colors.text;
  ctx.font = `600 16px ${opts.fontFamily}`;
  ctx.fillText(opts.title, PAD, PAD);
  ctx.fillStyle = colors.muted;
  ctx.font = `12px ${opts.fontFamily}`;
  ctx.fillText(opts.subtitle, PAD, PAD + 22);

  let y = headerHeight;
  for (const { row, lines } of laidOut) {
    ctx.fillStyle = colors.text;
    ctx.font = `600 13px ${opts.fontFamily}`;
    ctx.fillText(row.title, PAD, y);
    y += 18;
    // The canvas is `pxRatio` times its CSS size; draw it at the CSS size on the scaled context.
    ctx.drawImage(row.canvas, PAD, y, row.cssWidth, row.cssHeight);
    y += row.cssHeight;
    ctx.font = `${LEGEND_FONT}px ${opts.fontFamily}`;
    for (const line of lines) {
      for (const { item, x } of line) {
        ctx.fillStyle = item.color;
        ctx.fillRect(PAD + x, y + 3, SWATCH, SWATCH);
        ctx.fillStyle = colors.text;
        ctx.fillText(item.label, PAD + x + SWATCH + 6, y + 2);
      }
      y += LEGEND_LINE;
    }
    y += GAP;
  }

  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode the PNG'))), 'image/png');
  });
}
