import { css, html, nothing, svg, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import { GAUGE, GAUGE_ZONES, gaugeArcPath, gaugePoint, level, reasonKey } from '../core/detection';
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

/** Stroke icons shared by the gauge and the chip (feather-style, 24×24 viewBox, drawn 40×40). */
export const eyeIcon = html`<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
export const eyeOffIcon = html`<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M6.61 6.61A13.526 13.526 0 0 0 1 12s4 8 11 8a9.74 9.74 0 0 0 5.39-1.61"/></svg>`;

/**
 * The semicircular gauge of Obico's own web app: three zones (green, orange, red) as arc
 * segments, a ball on the arc at the current probability and the level label inside.
 * When Obico does not watch the printer the arc is grey with an eye-off icon, and the
 * reason is spelled out under the arc (it can be a long translated sentence, so it lives
 * in HTML, not in the SVG, and wraps).
 */
export function gauge(t: T, printer: ObicoPrinter): TemplateResult {
  const p = Math.min(1, Math.max(0, printer.normalized_p || 0));
  const live = printer.watching_enabled && !printer.not_watching_reason;
  const lv = level(p);
  const ball = gaugePoint(p);
  const reason = reasonText(t, printer);
  const gap = 0.012;
  return html`
    <div class="gauge ${live ? lv : 'idle'}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.round(p * 100)}
      aria-label=${t('obico.meter.label')}>
      <svg viewBox="0 0 100 62" dir="ltr" aria-hidden="true">
        ${GAUGE_ZONES.map(
          (z) =>
            svg`<path class="zone ${z.level}" d=${gaugeArcPath(z.from + (z.from === 0 ? 0 : gap), z.to - (z.to === 1 ? 0 : gap))} />`,
        )}
        ${live
          ? svg`
              <circle class="ball" cx=${ball.x.toFixed(2)} cy=${ball.y.toFixed(2)} r="4.5" />
              <text class="gauge-level" x="50" y="40">${levelLabel(t, p)}</text>
              <text class="gauge-pct" x="50" y="52">${Math.round(p * 100)}%</text>
            `
          : svg`<g class="eye-off" transform="translate(41 25) scale(0.75)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 1 12s4 8 11 8a9.74 9.74 0 0 0 5.39-1.61" />
            </g>`}
      </svg>
      ${live ? nothing : html`<p class="gauge-reason muted">${reason ?? t('obico.meter.notWatching')}</p>`}
    </div>
  `;
}

/** Styles of the semicircular gauge. */
export const gaugeStyles = css`
  .gauge {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }
  .gauge svg {
    display: block;
    inline-size: min(100%, 220px);
    block-size: auto;
    aspect-ratio: 100 / 62; /* совпадает с viewBox 0 0 100 62 */
    overflow: visible;
  }
  .gauge .zone {
    fill: none;
    stroke-width: 9;
  }
  .gauge .zone.good {
    stroke: var(--success);
  }
  .gauge .zone.fishy {
    stroke: var(--warning);
  }
  .gauge .zone.failing {
    stroke: var(--danger);
  }
  /* Idle must stay visible on every theme: --bg-surface-hover is nearly the card
     background in the dark theme, so a dimmed --text-muted is used instead. */
  .gauge.idle .zone {
    stroke: var(--text-muted);
    opacity: 0.35;
  }
  .gauge .ball {
    fill: var(--text-primary);
    stroke: var(--bg-surface);
    stroke-width: 2;
    /* cx/cy are CSS properties in SVG2; where they are not, the ball just jumps. */
    transition:
      cx 0.4s ease,
      cy 0.4s ease;
  }
  .gauge text {
    text-anchor: middle;
    font-family: inherit;
  }
  .gauge .gauge-level {
    font-size: 7.5px;
    font-weight: 600;
  }
  .gauge.good .gauge-level {
    fill: var(--success);
  }
  .gauge.fishy .gauge-level {
    fill: var(--warning);
  }
  .gauge.failing .gauge-level {
    fill: var(--danger);
  }
  .gauge .gauge-pct {
    font-size: 6.5px;
    fill: var(--text-secondary);
  }
  .gauge .eye-off {
    color: var(--text-muted);
  }
  .gauge .gauge-reason {
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .gauge .ball {
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
      /* Transparent: the widget card already has a background, a second one shows as a box. */
      background: transparent;
    }
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--space-sm);
      block-size: 100%;
      min-block-size: 60px;
      color: var(--text-muted);
      font-size: var(--font-size-sm);
      background: transparent;
      border-radius: var(--radius-sm);
      text-align: center;
      padding: var(--space-sm);
    }
    /* The line-art printer of the "no frame yet" state, like Obico's own placeholder. */
    .empty svg {
      opacity: 0.5;
      flex-shrink: 0;
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
    const waiting = this.src && !this.failed;
    // The printer outline only decorates "no frame yet"; "loading" stays text-only.
    return html`<div class="empty">
      ${waiting
        ? nothing
        : html`<svg width="40" height="40" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="10" y="4" width="28" height="40" rx="2" />
            <line x1="13" y1="14" x2="35" y2="14" />
            <rect x="21.5" y="11" width="5" height="5" />
            <line x1="24" y1="16" x2="24" y2="20" />
            <line x1="16" y1="34" x2="32" y2="34" />
            <line x1="19" y1="34" x2="19" y2="38" />
            <line x1="29" y1="34" x2="29" y2="38" />
          </svg>`}
      <span>${waiting ? this.t('obico.loading') : this.t('obico.snapshot.none')}</span>
    </div>`;
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
