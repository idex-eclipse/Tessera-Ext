import { css, html, nothing, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { StoreElement } from '../base-element';
import { availablePresets } from '../core/presets';
import { MotanError } from '../core/types';
import { PALETTE } from '../core/graph-model';
import { MAX_SAMPLES, SEGMENT_TIMES } from '../state';
import type { DatasetDialog } from './dataset-dialog';
import { styles } from './styles';

/** Millisecond text of a step in seconds: 0.0001 -> "0.1". */
const ms = (seconds: number): string => String(+(seconds * 1000).toFixed(4));

/**
 * <tessera-md-graphs-panel> - what to draw: the analysis window, the graph rows and the
 * series in them. Replaces motan_graph.py's `--skip`, `--duration`, `--segment-time` and
 * `-g "[[...]]"`: the window is three fields, a layout is a preset or built row by row,
 * and a series is added through the dataset dialog instead of being typed.
 */
export class GraphsPanel extends StoreElement {
  static override styles = [
    styles,
    css`
      .graph-row {
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        padding: var(--space-sm);
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
        min-width: 0;
      }
      .series {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--space-sm);
        min-width: 0;
      }
      .series .name {
        flex: 1 1 12rem;
        min-width: 0;
        font-size: var(--font-size-sm);
      }
      .series select {
        inline-size: 7.5rem;
      }
      .series input[type='range'] {
        inline-size: 6rem;
      }
      .swatch {
        inline-size: 14px;
        block-size: 14px;
        border-radius: 3px;
        flex: none;
      }
    `,
  ];

  /** The dialog is a sibling in the tab; found by tag when needed. */
  #dialog(): DatasetDialog | null {
    return (this.getRootNode() as ShadowRoot | Document).querySelector<DatasetDialog>('tessera-md-dataset-dialog');
  }

  override render(): TemplateResult | typeof nothing {
    const store = this.store;
    const st = store?.state;
    if (!store || !st?.capture || !st.info) return nothing;
    const presets = availablePresets(st.info);
    const w = st.window;
    const samples = Math.ceil(w.duration / w.segmentTime);
    const tooMany = samples > MAX_SAMPLES;
    const computing = store.computing;

    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.t('motiondiag.graphs.title')}</span>
          <span class="muted ltr">${this.t('motiondiag.graphs.captured', { sec: st.captureSeconds.toFixed(1) })}</span>
        </div>
        <div class="panel-body">
          <div class="fields">
            ${this.#number('motiondiag.graphs.skip', String(w.skip), 0, 0.1, (v) => store.setWindow({ skip: Math.max(0, v) }))}
            ${this.#number('motiondiag.graphs.duration', String(w.duration), 0.001, 0.5, (v) => store.setWindow({ duration: v }))}
            <label class="field">
              <span class="field-label">${this.t('motiondiag.graphs.step')}</span>
              <select class="ltr" @change=${(e: Event) => store.setWindow({ segmentTime: Number((e.target as HTMLSelectElement).value) })}>
                ${SEGMENT_TIMES.map((s) => html`<option value=${s} ?selected=${s === w.segmentTime}>${ms(s)} ms</option>`)}
              </select>
            </label>
          </div>
          ${tooMany ? html`<p class="warn">${this.t('motiondiag.graphs.tooMany', { n: samples.toLocaleString(), max: MAX_SAMPLES.toLocaleString() })}</p>` : nothing}

          <div class="row">
            <label class="field grow">
              <span class="field-label">${this.t('motiondiag.graphs.preset')}</span>
              <!-- Choosing a layout applies and draws it at once; editing the rows makes it "custom". -->
              <select
                id="preset"
                ?disabled=${presets.length === 0 || computing}
                @change=${(e: Event) => {
                  const id = (e.target as HTMLSelectElement).value;
                  if (id) store.applyPreset(id);
                }}
              >
                <option value="" ?selected=${st.preset === ''}>${this.t('motiondiag.graphs.presetCustom')}</option>
                ${presets.map(
                  (p) => html`<option value=${p.id} title=${this.t(p.descKey)} ?selected=${p.id === st.preset}>${this.t(p.labelKey)}</option>`,
                )}
              </select>
            </label>
          </div>

          ${repeat(
            st.graphs.rows,
            (r) => r.id,
            (row, i) => html`
              <div class="graph-row">
                <div class="row">
                  <strong class="grow">${this.t('motiondiag.graphs.rowTitle', { n: i + 1 })}</strong>
                  <button class="small" @click=${() => this.#dialog()?.open(row.id)}>${this.t('motiondiag.graphs.addSeries')}</button>
                  <button class="small danger" @click=${() => store.removeRow(row.id)}>${this.t('motiondiag.graphs.removeRow')}</button>
                </div>
                ${this.#seriesList(row.id)}
              </div>
            `,
          )}

          <div class="row">
            <button @click=${() => this.#dialog()?.open(null)}>${this.t('motiondiag.graphs.addRow')}</button>
            <span class="grow"></span>
            ${computing
              ? html`<button class="danger" @click=${() => store.cancelCompute()}>${this.t('motiondiag.graphs.cancel')}</button>`
              : html`<button
                  class="primary"
                  ?disabled=${st.graphs.rows.length === 0 || tooMany || !(w.duration > 0)}
                  @click=${() => void store.compute()}
                >
                  ${this.t(st.outdated ? 'motiondiag.graphs.build' : 'motiondiag.graphs.rebuild')}
                </button>`}
          </div>
          ${st.progress !== null
            ? html`<div class="bar"><span style="inline-size:${Math.round(st.progress * 100)}%"></span></div>`
            : nothing}
        </div>
      </section>
    `;
  }

  #number(labelKey: string, value: string, min: number, step: number, onSet: (v: number) => void): TemplateResult {
    return html`<label class="field">
      <span class="field-label">${this.t(labelKey)}</span>
      <input
        class="ltr"
        type="number"
        min=${min}
        step=${step}
        .value=${value}
        @change=${(e: Event) => {
          const v = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(v)) onSet(v);
        }}
      />
    </label>`;
  }

  #seriesList(rowId: string): TemplateResult {
    const store = this.store!;
    const row = store.state.graphs.rows.find((r) => r.id === rowId)!;
    const labels = store.describe(row.series.map((s) => s.name));
    return html`${row.series.map((s, i) => {
      const l = labels.get(s.name);
      const color = s.color || `var(${PALETTE[i % PALETTE.length]})`;
      return html`
        <div class="series">
          <span class="swatch" style="background:${color};opacity:${s.alpha}"></span>
          <span class="name ltr">
            ${l instanceof MotanError
              ? html`<span class="error">${s.name}: ${l.message}</span>`
              : html`${l ? l.label : s.name} <span class="muted">${l ? l.units.replace(/\n/g, ' ') : ''}</span>`}
          </span>
          <select
            title=${this.t('motiondiag.graphs.color')}
            @change=${(e: Event) => store.updateSeries(rowId, i, { color: (e.target as HTMLSelectElement).value })}
          >
            <option value="" ?selected=${s.color === ''}>${this.t('motiondiag.color.auto')}</option>
            ${PALETTE.map(
              (p) => html`<option value="var(${p})" ?selected=${s.color === `var(${p})`}>${this.t(`motiondiag.color.${p.slice(2)}`)}</option>`,
            )}
          </select>
          <input
            type="range"
            min="0.2"
            max="1"
            step="0.1"
            title=${this.t('motiondiag.graphs.opacity')}
            .value=${String(s.alpha)}
            @change=${(e: Event) => store.updateSeries(rowId, i, { alpha: Number((e.target as HTMLInputElement).value) })}
          />
          <button class="small icon" title=${this.t('motiondiag.graphs.removeSeries')} @click=${() => store.removeSeries(rowId, i)}>✕</button>
        </div>
      `;
    })}`;
  }
}
