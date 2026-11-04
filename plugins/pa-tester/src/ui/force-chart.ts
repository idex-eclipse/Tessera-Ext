import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit';
import uPlot from 'uplot';
import uplotCss from 'uplot/dist/uPlot.min.css?inline';

import { applyFilter, FILTER_MS_DEFAULT, type FilterKind } from '../force-filter';
import type { ForceUnit } from '../force-parse';
import type { SeriesBuffer } from '../series-buffer';

/**
 * <tessera-pa-force-chart> — rolling trace of the load cell, drawn with uPlot.
 *
 * The host's own chart (plugins/shared/uplot-core) is a Svelte component and
 * cannot be imported by a remote plugin, so this is the same idea on Lit: a
 * fixed window that ends "now", x axis in seconds before the last sample, the
 * theme taken from the host's CSS custom properties.
 *
 * The data lives in a SeriesBuffer owned by the tab. The tab calls
 * `requestUpdate()` through the `version` property after pushing samples; the
 * element redraws at most once per animation frame, however fast the sensor
 * is. uPlot's CSS is bundled as a string and adopted into the shadow root.
 *
 * Colours are read from computed style when the chart is built (uPlot paints on
 * a canvas, so CSS cannot reach it): `restyle()` rebuilds it after a theme change.
 *
 * A display filter (`filter`, `filterMs`) is applied when drawing; the buffer always
 * keeps what the sensor sent. The filtered values sit on the buffer's own x values, so
 * all columns share one x array (uPlot requires that) and the raw trace can be drawn
 * under the filtered one (`showRaw`). The envelope draws two lines, cold below and hot
 * above (`--cool`, `--heat`).
 */
export class PaForceChart extends LitElement {
  static override styles = [
    unsafeCSS(uplotCss),
    css`
      :host { display: block; position: relative; min-width: 0; }
      .wrap { width: 100%; height: var(--pa-chart-height, 220px); }
      .u-legend { display: none; }
      .readout {
        position: absolute;
        top: 4px;
        inset-inline-end: 8px;
        padding: 1px 6px;
        border-radius: var(--radius-sm, 4px);
        background: var(--bg-surface, #fff);
        border: 1px solid var(--border-color, #ccc);
        color: var(--text-primary);
        font-size: var(--font-size-sm, 12px);
        font-variant-numeric: tabular-nums;
        pointer-events: none;
      }
      .empty {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--text-muted);
        font-size: var(--font-size-sm, 12px);
        pointer-events: none;
        text-align: center;
        padding: var(--space-md, 12px);
      }
    `,
  ];

  static override properties = {
    buffer: { attribute: false },
    version: { type: Number },
    unit: { type: String },
    seconds: { type: Number },
    emptyText: { type: String },
    paused: { type: Boolean },
    filter: { type: String },
    filterMs: { type: Number },
    showRaw: { type: Boolean },
    readout: { state: true },
  };

  declare buffer: SeriesBuffer | null;
  declare version: number;
  declare unit: ForceUnit;
  declare seconds: number;
  declare emptyText: string;
  declare paused: boolean;
  declare filter: FilterKind;
  declare filterMs: number;
  declare showRaw: boolean;
  declare readout: string;

  #plot: uPlot | null = null;
  #frame = 0;
  #resize: ResizeObserver | null = null;
  /** Last data given to uPlot (the cursor readout looks values up in it). */
  #data: number[][] = [[], []];
  /** Snapshot shown while paused, so a filter change does not pull in newer samples. */
  #frozen: { t: number[]; v: number[] } | null = null;
  /** Series layout of the current plot: the raw trace is drawn only under a filter. */
  #withRaw = false;

  constructor() {
    super();
    this.buffer = null;
    this.version = 0;
    this.unit = 'g';
    this.seconds = 30;
    this.emptyText = '';
    this.paused = false;
    this.filter = 'raw';
    this.filterMs = FILTER_MS_DEFAULT;
    this.showRaw = false;
    this.readout = '';
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resize = new ResizeObserver(() => this.#fit());
    this.#resize.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#resize?.disconnect();
    this.#resize = null;
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#destroy();
  }

  /** Rebuilds the chart with the current theme colours. */
  restyle(): void {
    this.#destroy();
    this.#schedule(true);
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has('paused')) {
      const buf = this.buffer;
      this.#frozen = this.paused && buf ? { t: buf.times(), v: buf.values() } : null;
    }
    // the number of series changes with these: rebuild instead of just setting data
    if (changed.has('seconds') || changed.has('unit') || changed.has('filter') || changed.has('showRaw')) this.restyle();
    else if (changed.has('filterMs')) this.#schedule(true);
    else if (changed.has('version') || changed.has('paused')) this.#schedule();
  }

  /** `force`: redraw even while paused (a filter change must show on the frozen trace). */
  #schedule(force = false): void {
    if (this.#frame || (this.paused && !force)) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.#draw();
    });
  }

  #color(name: string, fallback: string): string {
    return getComputedStyle(this).getPropertyValue(name).trim() || fallback;
  }

  #destroy(): void {
    this.#plot?.destroy();
    this.#plot = null;
  }

  #fit(): void {
    const el = this.renderRoot.querySelector<HTMLElement>('.wrap');
    if (!el || el.clientWidth === 0) return;
    if (this.#plot) this.#plot.setSize({ width: el.clientWidth, height: el.clientHeight });
    else this.#schedule();
  }

  /** uPlot series for the current filter: [x, raw?, filtered | lower + upper]. */
  #series(line: string): uPlot.Series[] {
    const out: uPlot.Series[] = [{}];
    // the faint raw trace goes first so the filtered one is drawn on top
    if (this.#withRaw) out.push({ stroke: this.#color('--text-muted', '#888'), width: 1, points: { show: false } });
    if (this.filter === 'envelope') {
      out.push({ stroke: this.#color('--cool', '#40c4ff'), width: 1.5, points: { show: false } });
      out.push({ stroke: this.#color('--heat', '#ff6d00'), width: 1.5, points: { show: false } });
    } else {
      out.push({ stroke: line, width: 1.5, points: { show: false } });
    }
    return out;
  }

  #build(el: HTMLElement): uPlot {
    const line = this.#color('--accent', '#3b82f6');
    const axis = this.#color('--text-muted', '#888');
    const grid = this.#color('--border-color', '#8884');
    const unit = this.unit === 'g' ? 'g' : 'counts';
    const minSpan = this.unit === 'g' ? 2 : 25;

    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 200),
      height: Math.max(el.clientHeight, 120),
      legend: { show: false },
      cursor: { drag: { x: false, y: false }, points: { size: 6 } },
      scales: {
        x: { time: false, range: () => [-this.seconds, 0] },
        y: {
          range: (_u, min, max) => {
            if (!Number.isFinite(min) || !Number.isFinite(max)) return [-1, 1];
            const span = Math.max(max - min, minSpan);
            const mid = (max + min) / 2;
            return [mid - span * 0.6, mid + span * 0.6];
          },
        },
      },
      axes: [
        {
          stroke: axis,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          values: (_u, ticks) => ticks.map((t) => `${t}s`),
        },
        {
          stroke: axis,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid },
          size: 56,
          label: unit,
          labelSize: 14,
        },
      ],
      series: this.#series(line),
      hooks: {
        setCursor: [
          (u) => {
            const i = u.cursor.idx;
            if (i == null) {
              this.readout = '';
              return;
            }
            const digits = this.unit === 'g' ? 2 : 0;
            const first = this.#withRaw ? 2 : 1;
            const cols = this.#data.slice(first);
            const vals = cols.map((c) => c[i]);
            this.readout = vals.some((v) => v === undefined)
              ? ''
              : `${vals.map((v) => v!.toFixed(digits)).join(' … ')} ${unit}`;
          },
        ],
      },
    };
    return new uPlot(opts, this.#data as uPlot.AlignedData, el);
  }

  #draw(): void {
    const el = this.renderRoot.querySelector<HTMLElement>('.wrap');
    const buf = this.buffer;
    if (!el || !buf) return;

    const times = this.#frozen?.t ?? buf.times();
    const values = this.#frozen?.v ?? buf.values();
    const last = times[times.length - 1] ?? 0;
    // The filter runs on the absolute times so its bins stay put while the window scrolls.
    // x = seconds before the newest sample (≤ 0), so the window always ends at the right edge.
    const xs = times.map((t) => t - last);

    // The data must line up with the series, so it is assembled before the plot is built.
    this.#withRaw = this.showRaw && this.filter !== 'raw';
    const cols = applyFilter(this.filter, this.filterMs, times, values).cols;
    this.#data = [xs, ...(this.#withRaw ? [values] : []), ...cols];

    if (!this.#plot) {
      if (el.clientWidth === 0) return; // not laid out yet; ResizeObserver will call #fit
      this.#plot = this.#build(el);
      return; // uPlot was created with the data
    }
    this.#plot.setData(this.#data as uPlot.AlignedData);
  }

  override render(): TemplateResult {
    const empty = !this.buffer || this.buffer.length === 0;
    return html`
      <div class="wrap"></div>
      ${this.readout ? html`<span class="readout">${this.readout}</span>` : nothing}
      ${empty && this.emptyText ? html`<div class="empty">${this.emptyText}</div>` : nothing}
    `;
  }
}
