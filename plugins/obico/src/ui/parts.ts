import { css, html, nothing, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import { level, reasonKey } from '../core/detection';
import { hubFor } from '../core/hub';
import type { ObicoPrinter } from '../core/obico-api';

/**
 * Pieces shared by the chip, the widgets, the fleet panel and the alert overlay.
 */

type T = (key: string, params?: Record<string, string | number>) => string;

/** The Obico tab of the Machine page (deep link resolved by @core/system). */
export function tabHref(printerId: string): string {
  return `#/p/${encodeURIComponent(printerId)}/machine?section=${encodeURIComponent('tessera/obico/obico')}`;
}

/** The label of a probability, like Obico's gauge: "Looking good", "Fishy", "Failing". */
export function levelLabel(t: T, p: number): string {
  return t(`obico.level.${level(p)}`);
}

/** Why the printer is not watched, translated when the server text is known. */
export function reasonText(t: T, printer: ObicoPrinter): string | null {
  const reason = printer.not_watching_reason;
  if (!reason) return null;
  const key = reasonKey(reason);
  return key ? t(key) : reason;
}

/**
 * A horizontal gauge: Obico's three zones as the track, the bar up to `p`. Grey when the
 * printer is not watched: the number is then the last one, not a live verdict.
 */
export function meter(t: T, printer: ObicoPrinter): TemplateResult {
  const p = Math.min(1, Math.max(0, printer.normalized_p || 0));
  const live = printer.watching_enabled && !printer.not_watching_reason;
  const lv = level(p);
  return html`
    <div class="meter ${live ? lv : 'idle'}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(p * 100)}
      aria-label=${t('obico.meter.label')}>
      <div class="meter-track"><span style="inline-size: ${(p * 100).toFixed(0)}%"></span></div>
      <div class="meter-text">
        <span class="meter-level">${live ? levelLabel(t, p) : t('obico.meter.notWatching')}</span>
        <span class="ltr" dir="ltr">${Math.round(p * 100)}%</span>
      </div>
    </div>
  `;
}

/** Styles of the gauge. The bar grows from the inline start, so it mirrors in RTL. */
export const meterStyles = css`
  .meter {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .meter-track {
    block-size: 8px;
    border-radius: 4px;
    background: var(--bg-surface-hover);
    overflow: hidden;
  }
  .meter-track > span {
    display: block;
    block-size: 100%;
    background: var(--text-muted);
    transition: inline-size 0.4s ease;
  }
  .meter.good .meter-track > span {
    background: var(--success);
  }
  .meter.fishy .meter-track > span {
    background: var(--warning);
  }
  .meter.failing .meter-track > span {
    background: var(--danger);
  }
  .meter-text {
    display: flex;
    justify-content: space-between;
    gap: var(--space-sm);
    font-size: var(--font-size-sm);
  }
  .meter.good .meter-level {
    color: var(--success);
  }
  .meter.fishy .meter-level {
    color: var(--warning);
  }
  .meter.failing .meter-level {
    color: var(--danger);
    font-weight: 600;
  }
  .meter.idle .meter-level {
    color: var(--text-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    .meter-track > span {
      transition: none;
    }
  }
`;

/**
 * <tessera-obico-snapshot> - the latest webcam frame Obico analysed.
 *
 * The image goes through the service proxy (the browser cannot load it cross-origin with
 * the token), so it is fetched as a blob and shown as an object URL, which is revoked when
 * the frame changes or the element goes away. The previous frame stays while the next
 * one loads, so the picture does not blink every poll.
 */
export class ObicoSnapshot extends TesseraElement {
  static override styles = css`
    :host {
      display: block;
      min-width: 0;
      min-height: 0;
    }
    img {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      object-fit: contain;
      border-radius: var(--radius-sm);
      background: var(--bg-surface-hover);
    }
    .empty {
      display: grid;
      place-items: center;
      block-size: 100%;
      min-block-size: 60px;
      color: var(--text-muted);
      font-size: var(--font-size-sm);
      background: var(--bg-surface-hover);
      border-radius: var(--radius-sm);
      text-align: center;
      padding: var(--space-sm);
    }
  `;

  static override properties = {
    ...TesseraElement.properties,
    src: { attribute: false },
    objectUrl: { state: true },
    failed: { state: true },
  };

  /** The `pic.img_url` of the Obico printer; null when there is no frame yet. */
  declare src: string | null;
  declare objectUrl: string | null;
  declare failed: boolean;
  #loaded: string | null = null;

  constructor() {
    super();
    this.src = null;
    this.objectUrl = null;
    this.failed = false;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.#loaded = null;
  }

  override updated(): void {
    if (this.src && this.src !== this.#loaded && this.api && this.isConnected) void this.#load(this.src);
  }

  async #load(src: string): Promise<void> {
    this.#loaded = src;
    try {
      const url = await hubFor(this.api!).client.image(src);
      // A newer frame or a removal may have come while this one loaded.
      if (this.#loaded !== src || !this.isConnected) {
        URL.revokeObjectURL(url);
        return;
      }
      if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = url;
      this.failed = false;
    } catch {
      this.failed = !this.objectUrl;
    }
  }

  override render(): TemplateResult {
    if (this.objectUrl) return html`<img src=${this.objectUrl} alt=${this.t('obico.snapshot.alt')} />`;
    return html`<div class="empty">${this.src && !this.failed ? this.t('obico.loading') : this.t('obico.snapshot.none')}</div>`;
  }
}

/** Nothing, or a muted line: shared "why there is nothing to show" texts of the views. */
export function notReady(t: T, status: string, linked: number | null | undefined): TemplateResult | typeof nothing {
  if (status === 'unknown') return html`<p class="muted">${t('obico.loading')}</p>`;
  if (status === 'unavailable') return html`<p class="muted">${t('obico.api.unavailableShort')}</p>`;
  if (status === 'unconfigured') return html`<p class="muted">${t('obico.api.notSetUp')}</p>`;
  if (linked === null) return html`<p class="muted">${t('obico.api.notLinked')}</p>`;
  return nothing;
}
