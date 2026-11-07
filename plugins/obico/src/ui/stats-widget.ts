import { css, html, nothing, type TemplateResult } from 'lit';

import { HubElement } from '../base-element';
import { type AlertSummary, type Period, periodRange, summarizeAlerts } from '../core/detection';
import type { ObicoStats } from '../core/obico-api';
import { styles } from './styles';
import { notReady, tabHref } from './parts';

/** One loaded period, cached for the page: switching widgets or tabs does not refetch. */
interface StatsEntry {
  at: number;
  stats: ObicoStats;
  alerts: AlertSummary;
}

const CACHE_MS = 5 * 60_000;
const cache = new Map<string, StatsEntry>();

/**
 * <tessera-obico-stats-widget> - "Obico stats": prints, time and filament of a period, and
 * what the failure detection did in it: how many prints raised an alert and how the user
 * answered (a real failure, a false alarm, no answer). Data of the active printer, or of
 * every printer of the account.
 */
export class ObicoStatsWidget extends HubElement {
  static override styles = [
    styles,
    css`
      :host {
        block-size: 100%;
        gap: var(--space-sm);
        padding: var(--space-sm);
        box-sizing: border-box;
        overflow: auto;
      }
      .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 110px), 1fr));
        gap: var(--space-sm);
      }
      .tile {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: var(--space-xs) var(--space-sm);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        min-width: 0;
      }
      .tile b {
        font-size: 1.2em;
      }
      .seg button[aria-pressed='true'] {
        background: var(--accent);
        color: #fff;
      }
    `,
  ];

  static override properties = {
    ...HubElement.properties,
    period: { state: true },
    all: { state: true },
    entry: { state: true },
    loading: { state: true },
    failed: { state: true },
  };

  declare period: Period;
  /** Every printer of the account instead of the active one. */
  declare all: boolean;
  declare entry: StatsEntry | null;
  declare loading: boolean;
  declare failed: string;
  #wanted = '';

  constructor() {
    super();
    this.period = 'month';
    this.all = false;
    this.entry = null;
    this.loading = false;
    this.failed = '';
  }

  // willUpdate, not updated: the synchronous part of #ensure (cached entry, loading flag)
  // then lands in this same render instead of scheduling another one.
  override willUpdate(changed: Map<string, unknown>): void {
    super.willUpdate(changed);
    void this.#ensure();
  }

  /** Loads the selected period when the hub is ready and nothing (fresh) is shown for it. */
  async #ensure(force = false): Promise<void> {
    const hub = this.hub;
    const api = this.api;
    if (!hub || !api || hub.status !== 'ready') return;
    const own = hub.obicoIdFor(api.printer.id);
    if (!this.all && own == null) return;
    const ids = this.all ? [] : [own as number];
    const key = `${this.period}:${ids.join(',')}`;
    const cached = cache.get(key);
    if (!force && cached && Date.now() - cached.at < CACHE_MS) {
      if (this.entry !== cached) this.entry = cached;
      return;
    }
    if (this.#wanted === key && !force) return;
    this.#wanted = key;
    this.loading = true;
    this.failed = '';
    try {
      const range = periodRange(this.period, new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
      const [stats, prints] = await Promise.all([hub.client.stats(range, ids), hub.client.prints(range, ids)]);
      const entry = { at: Date.now(), stats, alerts: summarizeAlerts(prints) };
      cache.set(key, entry);
      if (this.#wanted === key) this.entry = entry;
    } catch (e) {
      if (this.#wanted === key) this.failed = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.#wanted === key) {
        this.loading = false;
        this.#wanted = '';
      }
    }
  }

  #select(period: Period): void {
    this.period = period;
    this.entry = null;
  }

  override render(): TemplateResult {
    const hub = this.hub;
    const api = this.api;
    if (!hub || !api) return html``;
    const linked = hub.obicoIdFor(api.printer.id);
    const blocked = notReady(this.t, hub.status, this.all ? 0 : linked);
    if (blocked !== nothing) return html`${blocked}<a href=${tabHref(api.printer.id)}>${this.t('obico.openTab')}</a>`;

    const periods: Period[] = ['week', 'month', 'year'];
    const e = this.entry;
    const nf = new Intl.NumberFormat(api.i18n.locale, { maximumFractionDigits: 1 });
    return html`
      <div class="row">
        <div class="row seg" role="group" aria-label=${this.t('obico.stats.period')}>
          ${periods.map(
            (p) => html`<button aria-pressed=${this.period === p ? 'true' : 'false'} @click=${() => this.#select(p)}>
              ${this.t(`obico.stats.${p}`)}
            </button>`,
          )}
        </div>
        <label class="row">
          <input
            type="checkbox"
            .checked=${this.all}
            @change=${(ev: Event) => {
              this.all = (ev.target as HTMLInputElement).checked;
              this.entry = null;
            }}
          />
          <span>${this.t('obico.stats.allPrinters')}</span>
        </label>
      </div>
      ${this.failed ? html`<p class="error">${this.t('obico.error', { error: this.failed })}</p>` : nothing}
      ${!e
        ? html`<p class="muted">${this.loading ? this.t('obico.loading') : ''}</p>`
        : html`<div class="tiles">
            ${this.#tile('obico.stats.prints', nf.format(e.stats.total_print_count))}
            ${this.#tile('obico.stats.succeeded', nf.format(e.stats.total_succeeded_print_count))}
            ${this.#tile('obico.stats.cancelled', nf.format(e.stats.total_cancelled_print_count))}
            ${this.#tile('obico.stats.hours', nf.format(e.stats.total_print_time / 3600))}
            ${this.#tile('obico.stats.filament', nf.format(e.stats.total_filament_used / 1000))}
            ${this.#tile('obico.stats.alerted', nf.format(e.alerts.alerted))}
            ${this.#tile('obico.stats.failures', nf.format(e.alerts.failures))}
            ${this.#tile('obico.stats.falseAlarms', nf.format(e.alerts.falseAlarms))}
            ${this.#tile('obico.stats.unanswered', nf.format(e.alerts.unanswered))}
          </div>`}
    `;
  }

  #tile(key: string, value: string): TemplateResult {
    return html`<div class="tile"><span class="muted">${this.t(key)}</span><b class="ltr" dir="ltr">${value}</b></div>`;
  }
}
