import { css, html, nothing, type TemplateResult } from 'lit';

import { HubElement } from '../base-element';
import { alertPending } from '../core/detection';
import type { PluginApi } from '../sdk';
import { styles } from './styles';
import { meter, meterStyles, reasonText } from './parts';

/**
 * <tessera-obico-fleet-panel> - Obico on a printer card of fleet mode: the gauge and a red
 * line while an alert waits. Read only, as fleet panels should be: answering an alert is
 * done in the alert window, which shows for every printer of this Tessera.
 *
 * It also publishes an "Obico alert" tag to the fleet index, so the fleet filter can show
 * just the printers that need attention.
 */
export class ObicoFleetPanel extends HubElement {
  static override styles = [
    styles,
    meterStyles,
    css`
      :host {
        gap: var(--space-xs);
        padding: var(--space-xs) var(--space-sm);
      }
      .alert {
        color: var(--danger);
        font-weight: 600;
      }
    `,
  ];

  #published = '';

  protected override attachApi(api: PluginApi): void {
    super.attachApi(api);
    this.track(() => {
      if (this.params.printerId) api.fleet.retract(this.params.printerId);
      this.#published = '';
    });
  }

  override updated(): void {
    const api = this.api;
    const id = this.params.printerId;
    if (!api || !id || !this.hub) return;
    const pending = alertPending(this.hub.printerFor(id)?.current_print);
    // Publish only on a change: every publish re-filters the fleet.
    const sig = pending ? 'alert' : 'ok';
    if (sig === this.#published) return;
    this.#published = sig;
    api.fleet.publish(id, {
      tags: pending ? [{ id: 'obico-alert', labelKey: 'obico.fleet.alertTag', order: 0 }] : [],
      searchText: pending ? this.t('obico.fleet.alertTag') : '',
    });
  }

  override render(): TemplateResult {
    const hub = this.hub;
    const id = this.params.printerId;
    if (!hub || !id) return html``;
    const printer = hub.printerFor(id);
    // Nothing to show on printers without Obico: the panel must not clutter every card.
    if (!printer) return html``;
    const reason = reasonText(this.t, printer);
    return html`
      ${meter(this.t, printer)}
      ${alertPending(printer.current_print) ? html`<p class="alert" role="status">${this.t('obico.alert.short')}</p>` : nothing}
      ${reason && printer.current_print ? html`<p class="muted">${reason}</p>` : nothing}
    `;
  }
}
