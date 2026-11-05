import { css, html, nothing, type TemplateResult } from 'lit';

import { RuntimeElement } from '../base-element';
import { byUrgency, summarize } from '../core/evaluate';
import { fmtProgress, maintenanceHref, statusKey, taskName, worstUnit } from './format';
import { statusStyles, styles } from './styles';

/** Rows shown in the widget before "+N more". */
const MAX_ROWS = 5;

/**
 * <tessera-maintenance-widget> - the dashboard widget: the most urgent tasks at a glance
 * and a link to the full tab. Read-only on purpose: pressing results needs the note and
 * the explanation that live on the cards.
 */
export class MaintenanceWidget extends RuntimeElement {
  static override styles = [
    styles,
    statusStyles,
    css`
      :host {
        block-size: 100%;
        overflow: auto;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        flex-wrap: wrap;
        min-width: 0;
      }
      li .name {
        flex: 1;
        min-width: 8em;
        overflow-wrap: anywhere;
      }
      a {
        color: var(--accent);
        font-size: var(--font-size-sm);
      }
    `,
  ];

  override render(): TemplateResult {
    const rt = this.runtime;
    if (!rt || !rt.state) return html`<p class="muted">${this.t('maintenance.loading')}</p>`;
    const tr = (k: string, p?: Record<string, string | number>): string => this.t(k, p);
    const href = maintenanceHref(rt.printerId);

    if (!rt.state.onboarding.done) {
      return html`<a href=${href}>${tr('maintenance.wizard.title')}</a>`;
    }

    const rows = byUrgency(rt.state, rt.evals).filter((r) => r.evaluation.status === 'overdue' || r.evaluation.status === 'soon');
    const sum = summarize(rt.evals);
    const shown = rows.slice(0, MAX_ROWS);
    return html`
      <div class="row">
        ${sum.overdue > 0 ? html`<span class="chip overdue">${tr('maintenance.summary.overdue', { n: sum.overdue })}</span>` : nothing}
        ${sum.soon > 0 ? html`<span class="chip soon">${tr('maintenance.summary.soon', { n: sum.soon })}</span>` : nothing}
        ${sum.overdue + sum.soon === 0 ? html`<span class="chip live">${tr('maintenance.summary.allOk')}</span>` : nothing}
      </div>
      <ul>
        ${shown.map(({ task, evaluation }) => {
          const u = worstUnit(evaluation);
          return html`<li>
            <span class="name">${taskName(tr, task)}${task.tool ? html` <span class="muted ltr">(${task.tool})</span>` : nothing}</span>
            <span class="chip ${evaluation.status}">${u && !evaluation.triggered ? fmtProgress(tr, u) : tr(statusKey(evaluation.status))}</span>
          </li>`;
        })}
      </ul>
      ${rows.length > MAX_ROWS ? html`<p class="muted">${tr('maintenance.widget.more', { n: rows.length - MAX_ROWS })}</p>` : nothing}
      <a href=${href}>${tr('maintenance.widget.openTab')}</a>
    `;
  }
}
