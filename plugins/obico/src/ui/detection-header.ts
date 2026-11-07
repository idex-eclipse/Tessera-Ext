import { css, html, type TemplateResult } from 'lit';

import { HubElement } from '../base-element';

/**
 * <tessera-obico-detection-header> - the headerElement of the detection widget (the host
 * puts it in the card header, params = {}): the "do not watch this print" switch. It is
 * shown only while there is a print to (un)mute; the rest of the time the header is
 * empty and takes no space.
 */
export class ObicoDetectionHeader extends HubElement {
  static override styles = css`
    :host {
      display: flex;
      align-items: center;
      min-width: 0;
    }
    label {
      display: inline-flex;
      align-items: center;
      gap: var(--space-xs);
      min-width: 0;
      color: var(--text-secondary);
      font-size: var(--font-size-sm);
      cursor: pointer;
    }
    /* A long translation truncates instead of pushing the card title away. */
    .text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    input {
      position: absolute;
      opacity: 0;
      inline-size: 1px;
      block-size: 1px;
    }
    /* The switch mirrors in RTL: the knob starts at the inline start. */
    .track {
      position: relative;
      flex-shrink: 0;
      inline-size: 28px;
      block-size: 16px;
      border-radius: 999px;
      background: var(--bg-surface-hover);
      border: 1px solid var(--border-color);
      transition: background var(--transition-fast, 0.15s ease);
    }
    .track::after {
      content: '';
      position: absolute;
      inset-inline-start: 2px;
      top: 2px;
      inline-size: 10px;
      block-size: 10px;
      border-radius: 50%;
      background: var(--text-muted);
      transition: inset-inline-start var(--transition-fast, 0.15s ease);
    }
    /* Muted detection is a warning state, hence --warning rather than --accent. */
    input:checked + .track {
      background: var(--warning);
      border-color: var(--warning);
    }
    input:checked + .track::after {
      inset-inline-start: 14px;
      background: #fff;
    }
    input:focus-visible + .track {
      outline: 2px solid var(--border-focus);
      outline-offset: 1px;
    }
    @media (prefers-reduced-motion: reduce) {
      .track,
      .track::after {
        transition: none;
      }
    }
  `;

  override render(): TemplateResult {
    const hub = this.hub;
    const api = this.api;
    if (!hub || !api) return html``;
    const printer = hub.printerFor(api.printer.id);
    const print = printer?.current_print;
    // Only a running, watched print can be (un)muted; otherwise the header stays empty.
    if (!printer || !print || !printer.watching_enabled) return html``;
    const muted = Boolean(print.alert_muted_at);
    const toggle = (e: Event) =>
      void hub.run(() => hub.client.mute(printer.id, (e.target as HTMLInputElement).checked)).catch(() => undefined);
    return html`<label title=${this.t('obico.alert.mute')}>
      <input type="checkbox" role="switch" .checked=${muted} @change=${toggle} />
      <span class="track" aria-hidden="true"></span>
      <span class="text">${this.t('obico.alert.mute')}</span>
    </label>`;
  }
}
