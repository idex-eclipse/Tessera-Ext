import { css, html, nothing, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import { ensureMonitor } from '../monitor';
import { currentStart, resolveStart, stashApi, subscribeQueue, type PendingStart } from '../queue';
import { peekRuntime } from '../hub';
import type { PluginApi } from '../sdk';
import { fmtProgress, maintenanceHref, taskName, worstUnit } from './format';
import { styles } from './styles';

/**
 * <tessera-maintenance-overlay> - the always-mounted overlay (manifest.json "overlays").
 *
 * It does two jobs. It starts the reminder monitor for every printer (that is why it is an
 * overlay: it must run whatever page is open). And it shows the pre-print dialog for the
 * request the guard froze: the bed check with the cameras and the list of overdue tasks.
 *
 * Overlay rules (docs/en/surfaces.md §4): the host puts everything inside this element on a
 * pointer-events layer, so while no dialog is open the element must render NOTHING.
 */
export class MaintenanceOverlay extends TesseraElement {
  static override styles = [
    styles,
    css`
      :host {
        display: contents;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--space-md);
        background: rgba(0, 0, 0, 0.55);
      }
      .dialog {
        inline-size: min(760px, 100%);
        max-block-size: 100%;
        overflow: auto;
      }
      label.check {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-block-size: 36px;
        overflow-wrap: anywhere;
      }
      ul {
        margin: 0;
        padding-inline-start: var(--space-lg);
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      h4 {
        margin: 0;
        font-size: var(--font-size-md);
      }
    `,
  ];

  static override properties = {
    ...TesseraElement.properties,
    pending: { state: true },
    confirmed: { state: true },
  };

  declare pending: PendingStart | null;
  declare confirmed: boolean;

  #onKey = (e: KeyboardEvent): void => {
    // Escape cancels the print, like the Cancel button.
    if (e.key === 'Escape' && this.pending) this.#decide(false);
  };

  constructor() {
    super();
    this.pending = null;
    this.confirmed = false;
  }

  protected override attachApi(api: PluginApi): void {
    super.attachApi(api);
    stashApi(api);
    ensureMonitor(api);
    this.pending = currentStart();
    this.track(subscribeQueue(() => this.#sync()));
    window.addEventListener('keydown', this.#onKey);
    this.track(() => {
      window.removeEventListener('keydown', this.#onKey);
      // The overlay is gone: nobody could resume a frozen print, so stop parking them.
      stashApi(null);
    });
  }

  #sync(): void {
    const next = currentStart();
    if (next?.token !== this.pending?.token) this.confirmed = false;
    this.pending = next;
  }

  #decide(accept: boolean, openTab = false): void {
    const item = this.pending;
    if (!item) return;
    const rt = peekRuntime(item.printerId);
    const names = item.overdue
      .map((id) => rt?.state?.tasks.find((t) => t.id === id))
      .filter((t) => !!t)
      .map((t) => taskName((k, p) => this.t(k, p), t!));
    resolveStart(accept);
    // Started anyway with work overdue: the journal keeps the fact.
    if (accept && names.length > 0) rt?.logEvent(names.join(', '), 'startedAnyway');
    if (openTab) location.hash = maintenanceHref(item.printerId);
  }

  override render(): TemplateResult {
    const item = this.pending;
    if (!item || !this.api) return html``;
    const tr = (k: string, p?: Record<string, string | number>): string => this.t(k, p);
    const rt = peekRuntime(item.printerId);
    const overdue = item.overdue
      .map((id) => {
        const task = rt?.state?.tasks.find((t) => t.id === id);
        const ev = rt?.evals.find((e) => e.taskId === id);
        return task && ev ? { task, ev } : null;
      })
      .filter((x) => !!x);
    // The confirmation is required only for the bed check; overdue work never blocks a print.
    const canStart = !item.bedCheck || this.confirmed;

    return html`
      <div class="backdrop" role="presentation">
        <section class="panel dialog" role="dialog" aria-modal="true" aria-label=${tr('maintenance.guard.title')}>
          <div class="panel-header">
            <span class="panel-title">${tr('maintenance.guard.title')}</span>
            ${item.filename ? html`<span class="chip ltr">${item.filename}</span>` : nothing}
          </div>
          <div class="panel-body">
            ${item.bedCheck
              ? html`
                  <h4>${tr('maintenance.guard.bedTitle')}</h4>
                  <tessera-maint-cameras .api=${this.api} .printerId=${item.printerId}></tessera-maint-cameras>
                  <label class="check">
                    <input type="checkbox" .checked=${this.confirmed} @change=${(e: Event) => (this.confirmed = (e.target as HTMLInputElement).checked)} />
                    ${tr('maintenance.guard.bedConfirm')}
                  </label>
                `
              : nothing}
            ${overdue.length > 0
              ? html`
                  <h4>${tr('maintenance.guard.overdueTitle')}</h4>
                  <ul>
                    ${overdue.map(({ task, ev }) => {
                      const u = worstUnit(ev);
                      return html`<li>
                        ${taskName(tr, task)}${task.tool ? html` <span class="muted ltr">(${task.tool})</span>` : nothing}
                        <span class="muted">${ev.triggered || !u ? '' : `- ${fmtProgress(tr, u)}`}</span>
                      </li>`;
                    })}
                  </ul>
                  <p class="muted">${tr('maintenance.guard.overdueHint')}</p>
                `
              : nothing}
            <div class="row">
              <button class="primary" ?disabled=${!canStart} @click=${() => this.#decide(true)}>${tr(overdue.length > 0 ? 'maintenance.guard.startAnyway' : 'maintenance.guard.start')}</button>
              <button @click=${() => this.#decide(false)}>${tr('maintenance.common.cancel')}</button>
              ${overdue.length > 0 ? html`<button @click=${() => this.#decide(false, true)}>${tr('maintenance.guard.open')}</button>` : nothing}
            </div>
          </div>
        </section>
      </div>
    `;
  }
}
