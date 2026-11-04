import { css, html, nothing, unsafeCSS, type PropertyValues, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import uPlot from 'uplot';
import uplotCss from 'uplot/dist/uPlot.min.css?inline';

import { StoreElement } from '../base-element';
import { thinRange } from '../core/decimate';
import { assignAxes, PALETTE, type GraphRow } from '../core/graph-model';
import { wheelDelta, zoomAround } from '../core/zoom';
import { composePng, type PngRow } from './png';
import { styles } from './styles';

/** Shared by every chart so a zoom or the cursor on one row moves all rows. */
const SYNC_KEY = 'tessera-motion-diag';

const CHART_HEIGHT = 260;

/** Parses `#rgb`, `#rrggbb` and `rgb[a](...)` into [r, g, b]; null for anything else. */
export function parseColor(css: string): [number, number, number] | null {
  const s = css.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]!].map((c) => parseInt(c + c, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** `color` with opacity `alpha`; colors this cannot parse are used as they are. */
export function withAlpha(color: string, alpha: number): string {
  const rgb = parseColor(color);
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : color;
}

interface RowPlot {
  plot: uPlot;
  /** Series colors and names, for the legend of an exported picture. */
  legend: Array<{ color: string; label: string }>;
  /** What the plot was built from; a change rebuilds it. */
  signature: string;
}

/**
 * <tessera-md-graphs> - the charts of the computed datasets, one uPlot per row.
 *
 * Rows share the time axis (zoom and the cursor are synchronized). Series with other units
 * go to a second axis on the right, like motan_graph.py. Long series are thinned to about
 * two points per pixel keeping each bucket's minimum and maximum; zooming re-thins the
 * visible part from the full data, so detail comes back as you zoom in.
 *
 * uPlot paints on a canvas, so CSS cannot reach it: colors are read from the host's
 * custom properties when a chart is built, and a theme change rebuilds the charts.
 */
export class GraphView extends StoreElement {
  static override styles = [
    styles,
    unsafeCSS(uplotCss),
    css`
      .chart {
        inline-size: 100%;
        min-inline-size: 0;
      }
      .u-legend {
        font-size: var(--font-size-sm);
        text-align: start;
      }
      .u-legend .u-marker {
        inline-size: 14px;
      }
      /* Legend values are numbers: keep them left-to-right in any UI direction. */
      .u-legend .u-value {
        direction: ltr;
        unicode-bidi: isolate;
      }
      .failed {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-xs);
      }
    `,
  ];

  #plots = new Map<string, RowPlot>();
  #resize: ResizeObserver | null = null;
  #theme = '';

  protected override attachApi(api: NonNullable<typeof this.api>): void {
    super.attachApi(api);
    // The canvas does not follow CSS: rebuild the charts when the theme changes.
    this.track(api.onThemeChange(() => this.#destroyAll(true)));
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
    this.#destroyAll(false);
  }

  #destroyAll(rerender: boolean): void {
    for (const p of this.#plots.values()) p.plot.destroy();
    this.#plots.clear();
    if (rerender) this.requestUpdate();
  }

  #fit(): void {
    for (const [id, p] of this.#plots) {
      const el = this.renderRoot.querySelector<HTMLElement>(`[data-row="${id}"]`);
      if (el && el.clientWidth > 0) p.plot.setSize({ width: el.clientWidth, height: CHART_HEIGHT });
    }
  }

  override render(): TemplateResult | typeof nothing {
    const store = this.store;
    if (!store) return nothing;
    const st = store.state;
    if (!st.capture) return nothing;
    const computed = st.computed;

    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.t('motiondiag.graphs.chartsTitle')}</span>
          ${st.outdated && computed ? html`<span class="chip">${this.t('motiondiag.graphs.outdated')}</span>` : nothing}
        </div>
        <div class="panel-body">
          ${st.computeError ? html`<p class="error">${st.computeError}</p>` : nothing}
          ${!computed && !st.computeError ? html`<p class="muted">${this.t('motiondiag.graphs.notBuilt')}</p>` : nothing}
          ${computed
            ? repeat(
                st.graphs.rows,
                (row) => row.id,
                (row, i) => html`
                  <div>
                    <div class="row">
                      <strong>${this.t('motiondiag.graphs.rowTitle', { n: i + 1 })}</strong>
                      <span class="failed">
                        ${row.series
                          .filter((s) => computed.errors.has(s.name))
                          .map((s) => html`<span class="chip bad ltr" title=${computed.errors.get(s.name)!}>${s.name}: ${computed.errors.get(s.name)}</span>`)}
                      </span>
                    </div>
                    <div class="chart" data-row=${row.id}></div>
                  </div>
                `,
              )
            : nothing}
        </div>
      </section>
    `;
  }

  override updated(_changed: PropertyValues): void {
    const st = this.store?.state;
    const computed = st?.computed;
    if (!st || !computed) {
      this.#destroyAll(false);
      return;
    }
    // Colors depend on the theme: read them again when the tokens changed.
    const theme = getComputedStyle(this).getPropertyValue('--bg-surface');
    if (theme !== this.#theme) {
      this.#theme = theme;
      this.#destroyAll(false);
    }

    const live = new Set(st.graphs.rows.map((r) => r.id));
    for (const [id, p] of this.#plots) {
      if (!live.has(id)) {
        p.plot.destroy();
        this.#plots.delete(id);
      }
    }
    st.graphs.rows.forEach((row) => {
      const el = this.renderRoot.querySelector<HTMLElement>(`[data-row="${row.id}"]`);
      if (!el) return;
      const signature = JSON.stringify([row.series, computed.data.times.length, computed.window]) + String(computed.data.series.size);
      const existing = this.#plots.get(row.id);
      if (existing && existing.signature === signature && existing.plot.root.parentElement === el) return;
      existing?.plot.destroy();
      this.#plots.delete(row.id);
      const built = this.#build(el, row);
      if (built) this.#plots.set(row.id, { ...built, signature });
    });
  }

  /** Whether there is at least one chart to put into a picture. */
  get canExportPng(): boolean {
    return this.#plots.size > 0;
  }

  /**
   * All charts as one PNG, as they are on screen (a zoom is kept), with titles and legends.
   * `rowTitle(n)` names the n-th graph (1-based) in the picture's language.
   */
  exportPng(title: string, subtitle: string, rowTitle: (n: number) => string): Promise<Blob> {
    const rows: PngRow[] = [];
    this.store!.state.graphs.rows.forEach((row, i) => {
      const p = this.#plots.get(row.id);
      const canvas = p?.plot.root.querySelector('canvas');
      if (!p || !canvas) return;
      rows.push({
        title: rowTitle(i + 1),
        canvas,
        cssWidth: p.plot.width,
        cssHeight: p.plot.height,
        legend: p.legend,
      });
    });
    const style = getComputedStyle(this);
    return composePng({
      title,
      subtitle,
      rows,
      pxRatio: rows[0] ? rows[0].canvas.width / rows[0].cssWidth : 1,
      colors: {
        background: this.#token('--bg-surface', '#ffffff'),
        text: this.#token('--text-primary', '#1a1a1a'),
        muted: this.#token('--text-muted', '#888888'),
      },
      fontFamily: style.fontFamily || 'sans-serif',
    });
  }

  #token(name: string, fallback: string): string {
    return getComputedStyle(this).getPropertyValue(name).trim() || fallback;
  }

  /** A series color: a theme token (`var(--accent)`), a literal, or the palette entry for its index. */
  #color(spec: string, index: number): string {
    const raw = spec || `var(${PALETTE[index % PALETTE.length]})`;
    const m = /^var\((--[\w-]+)\)$/.exec(raw);
    return m ? this.#token(m[1]!, '#888') : raw;
  }

  #build(el: HTMLElement, row: GraphRow): Pick<RowPlot, 'plot' | 'legend'> | null {
    const computed = this.store!.state.computed!;
    const { times, series, labels } = computed.data;
    const drawn = row.series.filter((s) => series.has(s.name));
    if (drawn.length === 0 || times.length === 0) return null;
    const ys = drawn.map((s) => series.get(s.name)!);
    const lbls = drawn.map((s) => labels.get(s.name)!);
    const axes = assignAxes(lbls);
    const width = Math.max(el.clientWidth, 240);
    const maxPoints = Math.max(600, width * 2);
    const first = times[0]!;
    const last = times[times.length - 1]!;

    const text = this.#token('--text-muted', '#888');
    const grid = this.#token('--border-color', '#8884');
    const unitsText = (u: string): string => u.replace(/\n/g, ' ');
    const thin = (from: number, to: number): uPlot.AlignedData => {
      const t = thinRange(times, ys, from, to, maxPoints);
      return [t.x, ...t.y] as uPlot.AlignedData;
    };

    let busy = false;
    const opts: uPlot.Options = {
      width,
      height: CHART_HEIGHT,
      scales: {
        x: { time: false, range: (_u, min, max) => [min, max] },
        y: {},
        y2: {},
      },
      axes: [
        { stroke: text, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, label: this.t('motiondiag.graphs.time') },
        { scale: 'y', stroke: text, grid: { stroke: grid, width: 1 }, ticks: { stroke: grid }, label: unitsText(axes.left), size: 70 },
        ...(axes.right !== null
          ? [{ scale: 'y2', side: 1, stroke: text, grid: { show: false }, ticks: { stroke: grid }, label: unitsText(axes.right), size: 70 } as uPlot.Axis]
          : []),
      ],
      series: [
        {},
        ...drawn.map((s, i) => ({
          label: lbls[i]!.label,
          scale: axes.sides[i] === 'right' ? 'y2' : 'y',
          stroke: withAlpha(this.#color(s.color, i), s.alpha),
          width: 1.2,
          points: { show: false },
          spanGaps: false,
        })),
      ],
      cursor: { sync: { key: SYNC_KEY, scales: ['x', null] }, drag: { x: true, y: false } },
      legend: { live: true },
      hooks: {
        // Shift + wheel zooms the time axis around the cursor, in all rows together. Plain
        // wheel is left alone so that the page still scrolls.
        ready: [
          (u) => {
            u.over.addEventListener(
              'wheel',
              (e: WheelEvent) => {
                if (!e.shiftKey) return;
                e.preventDefault();
                const { min, max } = u.scales.x ?? {};
                if (min == null || max == null) return;
                const focus = u.posToVal(e.clientX - u.over.getBoundingClientRect().left, 'x');
                // Do not zoom in past about 20 samples.
                const minSpan = Math.max(((last - first) / times.length) * 20, 1e-9);
                const next = zoomAround({ min, max }, focus, wheelDelta(e), { min: first, max: last }, minSpan);
                const all = [u, ...[...this.#plots.values()].map((p) => p.plot).filter((p) => p !== u)];
                for (const p of all) p.setScale('x', next);
              },
              { passive: false },
            );
          },
        ],
        setScale: [
          (u, key) => {
            if (key !== 'x' || busy) return;
            const { min, max } = u.scales.x ?? {};
            if (min == null || max == null) return;
            busy = true;
            u.setData(thin(min, max), false);
            busy = false;
          },
        ],
      },
    };
    const legend = drawn.map((s, i) => ({ color: withAlpha(this.#color(s.color, i), 1), label: lbls[i]!.label }));
    return { plot: new uPlot(opts, thin(first, last), el), legend };
  }
}
