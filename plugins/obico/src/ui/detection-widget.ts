import { css, html, nothing, type TemplateResult } from 'lit';

import { HubElement } from '../base-element';
import { alertPending, sparkline } from '../core/detection';
import { styles } from './styles';
import { meter, meterStyles, notReady, reasonText, tabHref } from './parts';

/**
 * <tessera-obico-detection-widget> - "Failure detection" on the dashboard, for the active
 * printer: Obico's gauge, the frame it last analysed, the probability over this print and
 * the two answers that need no dialog (stop watching this print; "not a failure").
 * Cancelling a print is left to the alert window and the print banner, where it is asked.
 */
export class ObicoDetectionWidget extends HubElement {
  static override styles = [
    styles,
    meterStyles,
    css`
      :host {
        block-size: 100%;
        gap: var(--space-sm);
        padding: var(--space-sm);
        box-sizing: border-box;
        overflow: auto;
      }
      /* The frame takes the free height; on a short widget it shrinks first. */
      tessera-obico-snapshot {
        flex: 1 1 80px;
      }
      svg {
        inline-size: 100%;
        block-size: 36px;
        display: block;
      }
      polyline {
        fill: none;
        stroke: var(--accent);
        stroke-width: 1.2;
        vector-effect: non-scaling-stroke;
      }
      line {
        stroke: var(--border-color);
        stroke-dasharray: 2 2;
        vector-effect: non-scaling-stroke;
      }
      .alert {
        color: var(--danger);
        font-weight: 600;
      }
    `,
  ];

  override render(): TemplateResult {
    const hub = this.hub;
    const api = this.api;
    if (!hub || !api) return html``;
    const linked = hub.obicoIdFor(api.printer.id);
    const blocked = notReady(this.t, hub.status, linked);
    if (blocked !== nothing) return html`${blocked}<a href=${tabHref(api.printer.id)}>${this.t('obico.openTab')}</a>`;

    const printer = hub.printerFor(api.printer.id);
    if (!printer) {
      return html`<p class="muted">${hub.status === 'error' ? this.t('obico.api.failed') : this.t('obico.api.notFound')}</p>`;
    }
    const print = printer.current_print;
    const reason = reasonText(this.t, printer);
    const samples = hub.samples(printer.id);
    const run = (action: () => Promise<unknown>) => void hub.run(action).catch(() => undefined);

    return html`
      ${meter(this.t, printer)}
      ${alertPending(print) ? html`<p class="alert" role="alert">${this.t('obico.alert.short')}</p>` : nothing}
      ${reason ? html`<p class="muted">${reason}</p>` : nothing}
      <tessera-obico-snapshot .api=${api} .src=${printer.pic?.img_url ?? null}></tessera-obico-snapshot>
      ${samples.length > 1
        ? html`<svg viewBox="0 0 100 30" preserveAspectRatio="none" dir="ltr" role="img" aria-label=${this.t('obico.widget.graph')}>
            <line x1="0" x2="100" y1="20.1" y2="20.1"></line>
            <line x1="0" x2="100" y1="9.9" y2="9.9"></line>
            <polyline points=${sparkline(samples)}></polyline>
          </svg>`
        : nothing}
      ${print
        ? html`<div class="row">
            ${alertPending(print)
              ? html`<button @click=${() => run(() => hub.client.acknowledge(printer.id, 'NOT_FAILED'))}>${this.t('obico.alert.notFailure')}</button>`
              : nothing}
            ${!print.alert_muted_at && printer.watching_enabled
              ? html`<button @click=${() => run(() => hub.client.mute(printer.id))}>${this.t('obico.alert.mute')}</button>`
              : nothing}
          </div>`
        : nothing}
    `;
  }
}
