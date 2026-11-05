import { css, html, nothing, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import type { MaintenanceRuntime } from '../core/runtime';
import type { Task, TaskEvaluation } from '../core/types';
import { calibrationsHref, fmtProgress, fraction, outcomeLabel, statusKey, taskName } from './format';
import { statusStyles, styles } from './styles';

/**
 * <tessera-maint-card> - one task: progress per unit, the explanation, the result buttons.
 *
 * Pressing a result button first opens a small inline form (an optional note and a
 * confirmation), so a mis-tap on a phone does not restart a timer. The parent tab listens
 * for the `pressed` event to tell the user which cards became due.
 */
export class MaintCard extends TesseraElement {
  static override styles = [
    styles,
    statusStyles,
    css`
      :host {
        display: block;
      }
      /* Centred, like the chips and the button when they wrap under the title. */
      .name {
        overflow-wrap: anywhere;
        text-align: center;
      }
      .unit {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      textarea {
        min-width: 0;
        min-block-size: 56px;
        padding: var(--space-xs) var(--space-sm);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        background: var(--bg-surface);
        color: var(--text-primary);
        font: inherit;
        font-size: var(--font-size-sm);
        resize: vertical;
      }
      details > summary {
        cursor: pointer;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        min-block-size: 32px;
        display: flex;
        align-items: center;
      }
      details p {
        margin: var(--space-xs) 0 0;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        overflow-wrap: anywhere;
      }
    `,
  ];

  static override properties = {
    ...TesseraElement.properties,
    runtime: { attribute: false },
    task: { attribute: false },
    evaluation: { attribute: false },
    pending: { state: true },
    note: { state: true },
  };

  declare runtime: MaintenanceRuntime | null;
  declare task: Task | null;
  declare evaluation: TaskEvaluation | null;
  declare pending: string | null;
  declare note: string;

  constructor() {
    super();
    this.runtime = null;
    this.task = null;
    this.evaluation = null;
    this.pending = null;
    this.note = '';
  }

  #confirm(): void {
    const { runtime, task, pending } = this;
    if (!runtime || !task || !pending) return;
    const label = taskName((k, p) => this.t(k, p), task);
    const triggered = runtime.press(task.id, pending, this.note, label);
    this.pending = null;
    this.note = '';
    this.dispatchEvent(new CustomEvent('pressed', { detail: { triggered }, bubbles: true, composed: true }));
  }

  #edit(): void {
    this.dispatchEvent(new CustomEvent('edit-task', { detail: { id: this.task?.id }, bubbles: true, composed: true }));
  }

  override render(): TemplateResult {
    const { task, evaluation: ev, api } = this;
    if (!task || !ev || !api) return html``;
    const tr = (k: string, p?: Record<string, string | number>): string => this.t(k, p);
    const status = ev.status;
    const details = task.details;
    const axes =
      task.defId === 'lube-axes' && details
        ? (['x', 'y', 'z'] as const)
            .map((a) => `${tr(`maintenance.wizard.axis.${a}`)}: ${tr(`maintenance.rail.${details[a] ?? 'none'}`)}`)
            .join('; ')
        : '';
    const why = task.defId === 'custom' ? (task.instruction ?? '') : tr(`maintenance.task.${task.defId}.why`);

    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title name">${taskName(tr, task)}</span>
          <span class="panel-meta">
            ${task.tool ? html`<span class="chip ltr">${tr('maintenance.tool', { tool: task.tool })}</span>` : nothing}
            <span class="chip ${status}">${tr(statusKey(status))}</span>
            <button class="small" @click=${() => this.#edit()}>${tr('maintenance.common.edit')}</button>
          </span>
        </div>
        <div class="panel-body">
          ${ev.units.map(
            (u) => html`
              <div class="unit">
                <span class="muted">${fmtProgress(tr, u)}</span>
                <div class="bar ${u.status}"><span style="inline-size:${Math.round(fraction(u) * 100)}%"></span></div>
              </div>
            `,
          )}
          ${ev.triggered ? html`<p class="warn">${tr('maintenance.triggeredHint')}</p>` : nothing}
          ${why || axes
            ? html`<details>
                <summary>${tr('maintenance.common.why')}</summary>
                ${axes ? html`<p>${tr('maintenance.task.lube-axes.axes', { axes })}</p>` : nothing}
                ${why ? html`<p>${why}</p>` : nothing}
              </details>`
            : nothing}
          ${this.pending
            ? html`
                <textarea
                  .value=${this.note}
                  placeholder=${tr('maintenance.common.notePlaceholder')}
                  @input=${(e: Event) => (this.note = (e.target as HTMLTextAreaElement).value)}
                ></textarea>
                <div class="row">
                  <button class="primary" @click=${() => this.#confirm()}>
                    ${tr('maintenance.common.confirm')}: ${outcomeLabel(tr, task.outcomes.find((o) => o.id === this.pending) ?? { id: this.pending })}
                  </button>
                  <button
                    @click=${() => {
                      this.pending = null;
                      this.note = '';
                    }}
                  >
                    ${tr('maintenance.common.cancel')}
                  </button>
                </div>
              `
            : html`<div class="row">
                ${task.outcomes.map(
                  (o) => html`<button class=${status === 'overdue' ? 'primary' : ''} @click=${() => (this.pending = o.id)}>${outcomeLabel(tr, o)}</button>`,
                )}
                ${task.link?.calibrations && this.runtime
                  ? html`<a class="muted" href=${calibrationsHref(this.runtime.printerId, task.link.calibrations)}>${tr(`maintenance.link.${task.link.calibrations}`)}</a>`
                  : nothing}
              </div>`}
        </div>
      </section>
    `;
  }
}
