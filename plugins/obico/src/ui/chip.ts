import { css, html, nothing, type TemplateResult } from 'lit';

import { HubElement, TesseraElement } from '../base-element';
import { alertPending, level } from '../core/detection';
import { styles } from './styles';
import { eyeIcon, eyeOffIcon, reasonText, tabHref } from './parts';

/** The only item of the chip catalog: the failure probability of the active printer. */
export const CHIP_ITEM = 'probability';

/**
 * <tessera-obico-chip> - the failure probability of the active printer in the quick
 * access strip. The look copies the tuning chips of widgets-core (TuningChip.svelte):
 * an accent stripe at the inline start (red while an alert waits for an answer), the
 * label on top with the state next to it, and an eye icon with the percent at the bottom.
 * A click opens the Obico tab; nothing happens in dashboard edit mode, where the host
 * draws its own controls.
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
        position: relative;
        display: flex;
        block-size: 100%;
        box-sizing: border-box;
        /* The chip width follows its content: nothing inside truncates, the chip stretches. */
        min-inline-size: 104px;
        padding-block: 4px 6px;
        padding-inline: 12px 10px;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        color: var(--text-primary);
        text-decoration: none;
        overflow: hidden;
        transition:
          background var(--transition-fast, 0.15s ease),
          border-color var(--transition-fast, 0.15s ease),
          box-shadow var(--transition-fast, 0.15s ease);
      }
      a:hover {
        box-shadow: var(--shadow-sm);
        border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
      }
      a:active {
        transform: translateY(1px);
      }
      .stripe {
        position: absolute;
        inset-inline-start: 0;
        top: 0;
        bottom: 0;
        inline-size: 3px;
        background: var(--accent);
      }
      a.alert .stripe {
        background: var(--danger);
      }
      a.missing {
        border-style: dashed;
      }
      a.missing .stripe {
        background: var(--border-color);
      }
      .body {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 2px;
        min-width: 0;
        flex: 1;
      }
      .top {
        display: flex;
        align-items: baseline;
        gap: 6px;
        min-width: 0;
        font-weight: 600;
      }
      .label {
        flex: 1;
        min-width: 0;
        font-size: var(--font-size-lg);
        color: var(--accent);
        white-space: nowrap;
      }
      a.missing .label {
        color: var(--text-muted);
      }
      /* The state next to the label is short (a reason or "Possible failure"); a long
         custom label takes the width it needs, the chip stretches for both. */
      .sub {
        flex-shrink: 0;
        font-size: var(--font-size-sm);
        font-weight: 400;
        color: var(--text-muted);
        white-space: nowrap;
      }
      .sub.failing {
        color: var(--danger);
        font-weight: 600;
      }
      .bottom {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .kind {
        display: flex;
        line-height: 0;
        color: var(--text-muted);
        opacity: 0.55;
        flex-shrink: 0;
      }
      /* Watching: the open eye lights up with the theme accent. */
      .kind.on {
        color: var(--accent);
        opacity: 1;
      }
      /* An alert wins over the accent (and over .kind.on: one class more). */
      a.alert .kind {
        color: var(--danger);
        opacity: 1;
      }
      .value {
        margin-inline-start: auto;
        flex-shrink: 0;
        font-family: ui-monospace, monospace;
        font-size: var(--font-size-lg);
        font-weight: 700;
        color: var(--text-primary);
        font-variant-numeric: tabular-nums;
        line-height: 1;
      }
      .value.good {
        color: var(--success);
      }
      .value.fishy {
        color: var(--warning);
      }
      .value.failing {
        color: var(--danger);
      }
      .value.idle {
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
    const label = this.params.chipLabel || this.t('obico.chip.title');
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
        <span class="stripe"></span>
        <span class="body">
          <span class="top">
            <span class="label">${label}</span>
            <span class="sub">${why}</span>
          </span>
          <span class="bottom">
            <span class="kind">${eyeOffIcon}</span>
            <span class="value idle" dir="ltr">—</span>
          </span>
        </span>
      </a>`;
    }

    const p = Math.round((printer.normalized_p || 0) * 100);
    const watching = printer.watching_enabled && !printer.not_watching_reason;
    const pending = alertPending(printer.current_print);
    const reason = reasonText(this.t, printer);
    return html`<a class=${pending ? 'alert' : ''} href=${href} @click=${click} title=${reason ?? this.t('obico.chip.title')}>
      <span class="stripe"></span>
      <span class="body">
        <span class="top">
          <span class="label">${label}</span>
          ${pending
            ? html`<span class="sub failing">${this.t('obico.alert.short')}</span>`
            : !watching
              ? html`<span class="sub">${reason ?? this.t('obico.meter.notWatching')}</span>`
              : nothing}
        </span>
        <span class="bottom">
          <span class="kind ${watching ? 'on' : ''}">${watching ? eyeIcon : eyeOffIcon}</span>
          <span class="value ${watching ? level(printer.normalized_p || 0) : 'idle'}" dir="ltr">${p}%</span>
        </span>
      </span>
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
