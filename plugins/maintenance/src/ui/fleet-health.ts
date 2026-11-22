import { css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import { byUrgency, summarize } from '../core/evaluate';
import type { MaintenanceRuntime } from '../core/runtime';
import { runtimeFor } from '../hub';
import type { PluginApi } from '../sdk';
import { maintenanceHref, statusKey, taskName } from './format';
import { statusStyles, styles } from './styles';

/** Event consumed by @core/system#fleet-health-sections version 1. */
export const FLEET_HEALTH_REPORT_EVENT = 'mpu:fleet-health-report';

/** The compact popover intentionally caps detail so other health sections remain visible. */
const MAX_ROWS = 3;

type FleetHealthReport = { severity: 'none' | 'warn'; count: number };

/**
 * Maintenance section for System's Fleet Health popover.
 *
 * The element owns task presentation and reports only an aggregate severity to System. It
 * binds through params.printerId because opening fleet does not change the active printer.
 */
export class MaintenanceFleetHealth extends TesseraElement {
  static override properties = {
    ...TesseraElement.properties,
    runtime: { state: true },
  };

  static override styles = [
    styles,
    statusStyles,
    css`
      :host {
        display: block;
        min-inline-size: 0;
      }
      .section {
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
        min-inline-size: 0;
        border-block-start: 1px solid var(--border-color);
        padding-block-start: var(--space-sm);
      }
      .title {
        color: var(--text-muted);
        font-size: var(--font-size-2xs, var(--font-size-xs));
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
      }
      .counts {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-xs);
      }
      ul {
        display: flex;
        flex-direction: column;
        gap: 2px;
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        display: flex;
        align-items: baseline;
        gap: var(--space-xs);
        min-inline-size: 0;
        font-size: var(--font-size-sm);
      }
      /* Logical sizing and anywhere wrapping keep localized names inside narrow RTL/LTR popovers. */
      .name {
        flex: 1;
        min-inline-size: 0;
        overflow-wrap: anywhere;
      }
      .status {
        flex: none;
      }
      .more {
        margin: 0;
        font-size: var(--font-size-xs);
      }
      a {
        align-self: flex-start;
        min-block-size: var(--touch-target, 36px);
        display: inline-flex;
        align-items: center;
        color: var(--accent);
        font-size: var(--font-size-sm);
        font-weight: 600;
      }
    `,
  ];

  declare runtime: MaintenanceRuntime | null;

  #runtimeOff: (() => void) | null = null;
  #printerId = '';
  #lastReport = '';

  constructor() {
    super();
    this.runtime = null;
  }

  protected override attachApi(api: PluginApi): void {
    super.attachApi(api);
    this.#bind(api);
  }

  override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has('params') && this.api && this.isConnected) this.#bind(this.api);
  }

  override disconnectedCallback(): void {
    this.#runtimeOff?.();
    this.#runtimeOff = null;
    this.#printerId = '';
    this.#lastReport = '';
    super.disconnectedCallback();
  }

  override updated(): void {
    const report = this.#report();
    const signature = `${report.severity}:${report.count}`;
    if (signature === this.#lastReport) return;
    this.#lastReport = signature;
    this.dispatchEvent(new CustomEvent<FleetHealthReport>(FLEET_HEALTH_REPORT_EVENT, {
      bubbles: true,
      composed: true,
      detail: report,
    }));
  }

  /** Rebinds when the host reuses the contribution for another explicit printer. */
  #bind(api: PluginApi): void {
    const printerId = this.params.printerId?.trim() ?? '';
    if (printerId === this.#printerId) return;
    this.#runtimeOff?.();
    this.#runtimeOff = null;
    this.#printerId = printerId;
    this.runtime = printerId ? runtimeFor(api, printerId) : null;
    if (this.runtime) this.#runtimeOff = this.runtime.subscribe(() => this.requestUpdate());
    this.requestUpdate();
  }

  /** Only overdue work affects the shared indicator; soon work remains popover-only. */
  #report(): FleetHealthReport {
    const rt = this.runtime;
    if (!rt?.state?.onboarding.done) return { severity: 'none', count: 0 };
    const overdue = summarize(rt.evals).overdue;
    return overdue > 0 ? { severity: 'warn', count: overdue } : { severity: 'none', count: 0 };
  }

  override render(): TemplateResult | typeof nothing {
    const rt = this.runtime;
    if (!rt?.state?.onboarding.done) return nothing;
    const rows = byUrgency(rt.state, rt.evals)
      .filter(({ evaluation }) => evaluation.status === 'overdue' || evaluation.status === 'soon');
    if (rows.length === 0) return nothing;

    const tr = (key: string, params?: Record<string, string | number>): string => this.t(key, params);
    const summary = summarize(rt.evals);
    const shown = rows.slice(0, MAX_ROWS);
    return html`
      <section class="section" aria-label=${tr('maintenance.fleet.title')}>
        <span class="title">${tr('maintenance.fleet.title')}</span>
        <div class="counts">
          ${summary.overdue > 0 ? html`<span class="chip overdue">${tr('maintenance.summary.overdue', { n: summary.overdue })}</span>` : nothing}
          ${summary.soon > 0 ? html`<span class="chip soon">${tr('maintenance.summary.soon', { n: summary.soon })}</span>` : nothing}
        </div>
        <ul>
          ${shown.map(({ task, evaluation }) => html`
            <li>
              <span class="name">${taskName(tr, task)}${task.tool ? html` <bdi class="muted ltr">(${task.tool})</bdi>` : nothing}</span>
              <span class="status chip ${evaluation.status}">${tr(statusKey(evaluation.status))}</span>
            </li>
          `)}
        </ul>
        ${rows.length > MAX_ROWS ? html`<p class="more muted">${tr('maintenance.widget.more', { n: rows.length - MAX_ROWS })}</p>` : nothing}
        <a href=${maintenanceHref(rt.printerId)}>${tr('maintenance.fleet.open')}</a>
      </section>
    `;
  }
}
