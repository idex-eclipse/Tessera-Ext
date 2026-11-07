import { css, html, nothing, type TemplateResult } from 'lit';

import { HubElement, TesseraElement } from '../base-element';
import { alertPending, level } from '../core/detection';
import { styles } from './styles';
import { reasonText, tabHref } from './parts';

/** The only item of the chip catalog: the failure probability of the active printer. */
export const CHIP_ITEM = 'probability';

/**
 * <tessera-obico-chip> - the failure probability of the active printer in the quick
 * access strip: percent and Obico's colour zone, "not watching" when Obico does not look,
 * a red frame while an alert waits for an answer. A click opens the Obico tab; nothing
 * happens in dashboard edit mode, where the host draws its own controls.
 */
export class ObicoChip extends HubElement {
  static override styles = [
    styles,
    css`
      :host {
        block-size: 100%;
        gap: 0;
      }
      a {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 2px;
        block-size: 100%;
        box-sizing: border-box;
        /* The chip width follows its content but never grows past the strip's taste. */
        max-inline-size: 180px;
        min-inline-size: 90px;
        padding: var(--space-xs) var(--space-md);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        color: var(--text-primary);
        text-decoration: none;
      }
      a.missing {
        border-style: dashed;
        color: var(--text-muted);
      }
      a.alert {
        border-color: var(--danger);
        box-shadow: inset 0 0 0 1px var(--danger);
      }
      .name,
      .state {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .value {
        font-size: 1.3em;
        font-weight: 600;
      }
      .good {
        color: var(--success);
      }
      .fishy {
        color: var(--warning);
      }
      .failing {
        color: var(--danger);
      }
      .idle {
        color: var(--text-muted);
      }
    `,
  ];

  override render(): TemplateResult {
    const hub = this.hub;
    const api = this.api;
    if (!hub || !api) return html``;
    const edit = this.params.edit === '1';
    const printer = hub.printerFor(api.printer.id);
    const href = tabHref(api.printer.id);
    // In edit mode the chip is a picture: no navigation.
    const click = (ev: Event) => {
      if (edit) ev.preventDefault();
    };

    if (!printer) {
      const why =
        hub.status === 'unconfigured' || hub.status === 'unavailable'
          ? this.t('obico.api.notSetUp')
          : hub.obicoIdFor(api.printer.id) === null
            ? this.t('obico.api.notLinked')
            : this.t('obico.loading');
      return html`<a class="missing" href=${href} @click=${click} title=${why}>
        <span class="name">${this.params.chipLabel || this.t('obico.chip.title')}</span>
        <span class="state">${why}</span>
      </a>`;
    }

    const p = Math.round((printer.normalized_p || 0) * 100);
    const watching = printer.watching_enabled && !printer.not_watching_reason;
    const pending = alertPending(printer.current_print);
    const reason = reasonText(this.t, printer);
    return html`<a class=${pending ? 'alert' : ''} href=${href} @click=${click} title=${reason ?? this.t('obico.chip.title')}>
      <span class="name">${this.params.chipLabel || this.t('obico.chip.title')}</span>
      <span class="value ltr ${watching ? level(printer.normalized_p || 0) : 'idle'}" dir="ltr">${p}%</span>
      ${pending
        ? html`<span class="state failing">${this.t('obico.alert.short')}</span>`
        : !watching
          ? html`<span class="state">${reason ?? this.t('obico.meter.notWatching')}</span>`
          : nothing}
    </a>`;
  }
}

/**
 * <tessera-obico-chip-picker> - the catalog of the add dialog: one item, the probability
 * chip; hidden once it is placed.
 */
export class ObicoChipPicker extends TesseraElement {
  static override styles = [styles];

  override render(): TemplateResult {
    let placed: unknown = [];
    try {
      placed = JSON.parse(this.params.placed ?? '[]');
    } catch {
      placed = [];
    }
    if (Array.isArray(placed) && placed.includes(CHIP_ITEM)) return html`<p class="muted">${this.t('obico.chip.placed')}</p>`;
    return html`<button
      @click=${(ev: Event) =>
        (ev.currentTarget as HTMLElement).dispatchEvent(
          new CustomEvent('mpu:chip-pick', { bubbles: true, composed: true, detail: { id: CHIP_ITEM } }),
        )}
    >
      ${this.t('obico.chip.title')}
    </button>`;
  }
}
