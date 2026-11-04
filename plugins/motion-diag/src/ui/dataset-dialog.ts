import { css, html, nothing, type TemplateResult } from 'lit';

import { StoreElement } from '../base-element';
import {
  availableFuncs,
  completeNode,
  defaultNode,
  findFunc,
  nodeToName,
  type Choice,
  type Node,
  type ParamDef,
} from '../core/catalog';
import { MotanError, type DatasetLabel } from '../core/types';
import { styles } from './styles';

/**
 * <tessera-md-dataset-dialog> - builds one dataset from a form.
 *
 * This is what replaces motan's `deviation(stepq(stepper_x),kin(stepper_x))` strings: the
 * user picks a kind of data, fills its parameters from lists of what the capture has, and
 * nested inputs (a deviation of two datasets) open as nested forms. The catalog
 * (core/catalog.ts) describes every kind; this element only renders it.
 */
export class DatasetDialog extends StoreElement {
  static override styles = [
    styles,
    css`
      dialog {
        inline-size: min(560px, calc(100vw - 2 * var(--space-md)));
        max-block-size: calc(100vh - 2 * var(--space-md));
        padding: 0;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        color: var(--text-primary);
        box-shadow: var(--shadow-lg);
      }
      dialog::backdrop {
        background: var(--bg-overlay);
      }
      .head,
      .foot {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        padding: var(--space-sm) var(--space-md);
      }
      .head {
        border-block-end: 1px solid var(--border-color);
        font-weight: 600;
      }
      .foot {
        justify-content: flex-end;
        flex-wrap: wrap;
        border-block-start: 1px solid var(--border-color);
      }
      .body {
        padding: var(--space-md);
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
        overflow: auto;
        max-block-size: calc(100vh - 12rem);
      }
      /* A nested input is indented on the inline-start side, so it mirrors in RTL. */
      .nested {
        margin-inline-start: var(--space-sm);
        padding-inline-start: var(--space-sm);
        border-inline-start: 2px solid var(--accent-subtle-strong, var(--border-color));
        display: flex;
        flex-direction: column;
        gap: var(--space-sm);
      }
      .preview {
        padding: var(--space-xs) var(--space-sm);
        border: 1px dashed var(--border-color);
        border-radius: var(--radius-sm);
        font-size: var(--font-size-sm);
      }
    `,
  ];

  static override properties = {
    ...StoreElement.properties,
    node: { state: true },
    error: { state: true },
  };

  declare node: Node | null;
  declare error: string;

  #target: string | null = null;

  constructor() {
    super();
    this.node = null;
    this.error = '';
  }

  /** Opens the dialog to add a series to `rowId` (null: to a new row). */
  open(rowId: string | null): void {
    const info = this.store?.state.info;
    if (!info) return;
    this.#target = rowId;
    const first = availableFuncs(info)[0];
    this.node = first ? defaultNode(first.fn, info) : null;
    this.error = '';
    this.updateComplete.then(() => this.renderRoot.querySelector('dialog')?.showModal());
  }

  #close(): void {
    this.renderRoot.querySelector('dialog')?.close();
  }

  #add(): void {
    if (!this.node) return;
    try {
      this.store!.addSeries(this.#target, this.node);
      this.#close();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  override render(): TemplateResult | typeof nothing {
    const info = this.store?.state.info;
    if (!info) return nothing;
    const preview = this.#preview();
    return html`
      <dialog @close=${() => (this.node = null)}>
        <div class="head">${this.t('motiondiag.dialog.title')}</div>
        <div class="body">
          ${this.node ? this.#renderNode(this.node, (n) => (this.node = n)) : nothing}
          ${preview}
        </div>
        <div class="foot">
          <button @click=${() => this.#close()}>${this.t('motiondiag.dialog.cancel')}</button>
          <button class="primary" ?disabled=${!this.node || preview === null || preview.error !== undefined} @click=${() => this.#add()}>
            ${this.t('motiondiag.dialog.add')}
          </button>
        </div>
      </dialog>
    `;
  }

  /** Name and label of what the form describes, or the reason it is not valid yet. */
  #resolve(): { name: string; label: DatasetLabel } | { error: string } {
    const info = this.store!.state.info!;
    try {
      const name = nodeToName(this.node!, info);
      const label = this.store!.describe([name]).get(name);
      if (label instanceof MotanError) return { error: label.message };
      return { name, label: label! };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  #preview(): (TemplateResult & { error?: string }) | null {
    if (!this.node) return null;
    const r = this.#resolve();
    const out: TemplateResult & { error?: string } =
      'error' in r
        ? Object.assign(html`<p class="error">${r.error}</p>`, { error: r.error })
        : html`<div class="preview"><span class="muted">${this.t('motiondiag.dialog.result')}</span> <span class="ltr">${r.label.label}</span> <span class="muted ltr">${r.label.units.replace(/\n/g, ' ')}</span></div>`;
    return out;
  }

  #choiceLabel(c: Choice): string {
    return c.literal ? c.value : this.t(`motiondiag.choice.${c.value}`);
  }

  #renderNode(node: Node, replace: (n: Node) => void): TemplateResult {
    const info = this.store!.state.info!;
    const def = findFunc(node.fn)!;
    const funcs = availableFuncs(info);
    const group = (g: 'raw' | 'derived') => funcs.filter((f) => f.group === g);
    const rerender = () => {
      completeNode(node, info);
      this.error = '';
      this.requestUpdate();
    };
    return html`
      <label class="field">
        <span class="field-label">${this.t('motiondiag.dialog.kind')}</span>
        <select @change=${(e: Event) => replace(defaultNode((e.target as HTMLSelectElement).value, info))}>
          <optgroup label=${this.t('motiondiag.dialog.groupRaw')}>
            ${group('raw').map((f) => html`<option value=${f.fn} ?selected=${f.fn === node.fn}>${this.t(f.labelKey)}</option>`)}
          </optgroup>
          <optgroup label=${this.t('motiondiag.dialog.groupDerived')}>
            ${group('derived').map((f) => html`<option value=${f.fn} ?selected=${f.fn === node.fn}>${this.t(f.labelKey)}</option>`)}
          </optgroup>
        </select>
      </label>
      <p class="muted">${this.t(def.descKey)}</p>
      <div class="fields">
        ${def.params(node.args, info).filter((p) => p.kind !== 'dataset').map((p) => this.#renderParam(node, p, rerender))}
      </div>
      ${def.params(node.args, info)
        .filter((p) => p.kind === 'dataset')
        .map((p) => this.#renderDatasetParam(node, p, rerender))}
    `;
  }

  #renderParam(node: Node, p: ParamDef, rerender: () => void): TemplateResult {
    const value = String(node.args[p.key] ?? '');
    const set = (v: string) => {
      node.args[p.key] = v;
      rerender();
    };
    if (p.kind === 'choice') {
      return html`<label class="field">
        <span class="field-label">${this.t(p.labelKey)}</span>
        <select @change=${(e: Event) => set((e.target as HTMLSelectElement).value)}>
          ${p.optional ? html`<option value="" ?selected=${value === ''}>${this.t('motiondiag.dialog.default')}</option>` : nothing}
          ${(p.choices ?? []).map((c) => html`<option value=${c.value} ?selected=${c.value === value}>${this.#choiceLabel(c)}</option>`)}
        </select>
      </label>`;
    }
    if (p.kind === 'number') {
      return html`<label class="field">
        <span class="field-label">${this.t(p.labelKey)}</span>
        <input
          class="ltr"
          type="number"
          .value=${value}
          min=${p.min ?? nothing}
          step=${p.step ?? 'any'}
          placeholder=${p.optional ? (p.default ?? '') : ''}
          @input=${(e: Event) => set((e.target as HTMLInputElement).value)}
        />
      </label>`;
    }
    const listId = `sg-${p.key}`;
    return html`<label class="field">
      <span class="field-label">${this.t(p.labelKey)}</span>
      <input class="ltr" type="text" list=${listId} .value=${value} @input=${(e: Event) => set((e.target as HTMLInputElement).value)} />
      <datalist id=${listId}>${(p.suggest ?? []).map((s) => html`<option value=${s}></option>`)}</datalist>
    </label>`;
  }

  #renderDatasetParam(node: Node, p: ParamDef, rerender: () => void): TemplateResult {
    const info = this.store!.state.info!;
    const inner = node.args[p.key];
    const used = typeof inner === 'object';
    return html`
      <div class="field">
        <span class="field-label">
          ${p.optional
            ? html`<label class="check"
                ><input
                  type="checkbox"
                  .checked=${used}
                  @change=${(e: Event) => {
                    const on = (e.target as HTMLInputElement).checked;
                    const first = availableFuncs(info).find((f) => f.group === 'raw');
                    node.args[p.key] = on && first ? defaultNode(first.fn, info) : '';
                    rerender();
                  }}
                />
                ${this.t(p.labelKey)}</label
              >`
            : this.t(p.labelKey)}
        </span>
        ${used
          ? html`<div class="nested">
              ${this.#renderNode(inner as Node, (n) => {
                node.args[p.key] = n;
                rerender();
              })}
            </div>`
          : nothing}
      </div>
    `;
  }
}
