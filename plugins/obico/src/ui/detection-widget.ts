import { css, html, nothing, type TemplateResult } from 'lit';

import { HubElement } from '../base-element';
import { styles } from './styles';
import { gauge, gaugeStyles, notReady, tabHref } from './parts';

/**
 * <tessera-obico-detection-widget> - "Failure detection" on the dashboard, for the active
 * printer, deliberately minimal like Obico's own panel: the frame it last analysed and
 * the semicircular gauge under it. The "do not watch this print" switch lives in the card
 * header (tessera-obico-detection-header); the answers to an alert ("not a failure",
 * cancel) are asked by the alert window and the print banner.
 */
export class ObicoDetectionWidget extends HubElement {
  static override styles = [
    styles,
    gaugeStyles,
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

    return html`
      <tessera-obico-snapshot .api=${api} .src=${printer.pic?.img_url ?? null}></tessera-obico-snapshot>
      ${gauge(this.t, printer)}
    `;
  }
}
