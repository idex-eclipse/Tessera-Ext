import { css, html, nothing, type TemplateResult } from 'lit';

import { HubElement } from '../base-element';
import type { ObicoPrinter } from '../core/obico-api';
import { styles } from './styles';
import { gauge, gaugeStyles, notReady, tabHref } from './parts';

/**
 * <tessera-obico-camera-tab> - the analyzed-frame view in the core Camera widget.
 * The frame, gauge and print mute switch stay together; alerts are handled by the
 * separate overlay and print banner.
 */
export class ObicoCameraTab extends HubElement {
  static override styles = [
    styles,
    gaugeStyles,
    css`
      :host {
        display: flex;
        block-size: 100%;
        min-inline-size: 0;
        gap: var(--space-sm);
        padding: var(--space-sm);
        box-sizing: border-box;
        overflow: auto;
      }
      /* The frame takes the free height; on a short widget it shrinks first. */
      tessera-obico-snapshot {
        flex: 1 1 80px;
      }
      label {
        display: inline-flex;
        align-items: center;
        align-self: flex-start;
        gap: var(--space-xs);
        min-block-size: 36px;
        max-inline-size: 100%;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
        cursor: pointer;
      }
      /* Long translations wrap within the tab instead of widening a narrow widget. */
      .mute-text { overflow-wrap: anywhere; }
      input {
        position: absolute;
        opacity: 0;
        inline-size: 1px;
        block-size: 1px;
      }
      .track {
        position: relative;
        flex-shrink: 0;
        inline-size: 28px;
        block-size: 16px;
        border-radius: 999px;
        background: var(--bg-surface-hover);
        border: 1px solid var(--border-color);
      }
      /* Logical positioning keeps the switch direction correct in RTL. */
      .track::after {
        content: '';
        position: absolute;
        inset-inline-start: 2px;
        top: 2px;
        inline-size: 10px;
        block-size: 10px;
        border-radius: 50%;
        background: var(--text-muted);
      }
      input:checked + .track { background: var(--warning); border-color: var(--warning); }
      input:checked + .track::after { inset-inline-start: 14px; background: var(--bg-surface); }
      input:focus-visible + .track { outline: 2px solid var(--border-focus); outline-offset: 1px; }
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

    const frameUrl = printer.pic?.img_url ?? null;
    const muteSwitch = this.muteSwitch(printer);
    // Keep the meter directly after a frame, but put it at the card bottom while waiting for one.
    return html`
      <tessera-obico-snapshot .api=${api} .src=${frameUrl}></tessera-obico-snapshot>
      ${frameUrl ? html`${gauge(this.t, printer)}${muteSwitch}` : html`${muteSwitch}${gauge(this.t, printer)}`}
    `;
  }

  /** Shows the existing mute action only while a watched print can be muted. */
  private muteSwitch(printer: ObicoPrinter): TemplateResult | typeof nothing {
    const print = printer.current_print;
    if (!print || !printer.watching_enabled) return nothing;
    const toggle = (event: Event) =>
      void this.hub!.run(() => this.hub!.client.mute(printer.id, (event.target as HTMLInputElement).checked))
        .catch(() => undefined);
    return html`<label title=${this.t('obico.alert.mute')}>
      <input type="checkbox" role="switch" .checked=${Boolean(print.alert_muted_at)} @change=${toggle} />
      <span class="track" aria-hidden="true"></span>
      <span class="mute-text">${this.t('obico.alert.mute')}</span>
    </label>`;
  }
}
