import { css, html, nothing, type TemplateResult } from 'lit';

import { HubElement } from '../base-element';
import type { ObicoConfig } from '../core/config';
import type { ObicoEvent, ObicoPrinter, ReactionSettings } from '../core/obico-api';
import { styles } from './styles';

/** The admin page of a self-hosted server where an access token is created (Obico's OrcaSlicer guide). */
export function tokenPageUrl(serverUrl: string): string {
  return `${serverUrl}/admin/oauth2_provider/accesstoken/add/`;
}

/**
 * <tessera-obico-api> - the part of the Obico tab that needs the Obico API, below the
 * Moonraker-only panels of tab.ts:
 * - Connection: address and access token of the server, kept by Tessera's service proxy
 *   on the printer (the token is never shown again, only "saved");
 * - Failure detection: the reaction settings of this printer in Obico;
 * - Events: the latest Obico events of this printer.
 *
 * `config` is the agent's moonraker-obico.cfg (or null): its server is the default address.
 */
export class ObicoApiPanels extends HubElement {
  static override styles = [
    styles,
    css`
      :host {
        display: contents;
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
        gap: var(--space-sm);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .field > span {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      input,
      select {
        min-width: 0;
        min-block-size: 36px;
        padding: var(--space-xs) var(--space-sm);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        background: var(--bg-surface);
        color: var(--text-primary);
        font: inherit;
        font-size: var(--font-size-sm);
      }
      input[type='checkbox'] {
        min-block-size: 0;
        inline-size: 18px;
        block-size: 18px;
        accent-color: var(--accent);
      }
      input[type='range'] {
        padding: 0;
        accent-color: var(--accent);
      }
      label.check {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-block-size: 32px;
      }
      ol.events {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      ol.events li {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: var(--space-sm);
        align-items: baseline;
        padding-block: var(--space-xs);
        border-block-end: 1px solid var(--border-color);
      }
      ol.events time {
        font-size: var(--font-size-sm);
        color: var(--text-muted);
        white-space: nowrap;
      }
      .ERROR {
        color: var(--danger);
      }
      .WARNING {
        color: var(--warning);
      }
      .SUCCESS {
        color: var(--success);
      }
    `,
  ];

  static override properties = {
    ...HubElement.properties,
    config: { attribute: false },
    urlDraft: { state: true },
    secretDraft: { state: true },
    busy: { state: true },
    notice: { state: true },
    draft: { state: true },
    events: { state: true },
  };

  declare config: ObicoConfig | null;
  /** The address being typed; null = show the saved (or default) one. */
  declare urlDraft: string | null;
  declare secretDraft: string;
  declare busy: boolean;
  declare notice: { kind: 'ok' | 'error'; text: string } | null;
  /** Edited reaction settings; null = show the server's values. */
  declare draft: Partial<ReactionSettings> | null;
  declare events: ObicoEvent[] | null;
  #eventsFor: number | null = null;

  constructor() {
    super();
    this.config = null;
    this.urlDraft = null;
    this.secretDraft = '';
    this.busy = false;
    this.notice = null;
    this.draft = null;
    this.events = null;
  }

  async #do(action: () => Promise<unknown>, okKey: string): Promise<void> {
    this.busy = true;
    this.notice = null;
    try {
      await action();
      this.notice = { kind: 'ok', text: this.t(okKey) };
    } catch (e) {
      this.notice = { kind: 'error', text: this.t('obico.error', { error: e instanceof Error ? e.message : String(e) }) };
    } finally {
      this.busy = false;
    }
  }

  override updated(): void {
    // Events of the printer once its Obico printer is known; again after a printer switch.
    const printer = this.#printer();
    if (printer && this.#eventsFor !== printer.id) {
      this.#eventsFor = printer.id;
      this.draft = null;
      void this.#loadEvents();
    }
  }

  #printer(): ObicoPrinter | null {
    return this.hub && this.api ? this.hub.printerFor(this.api.printer.id) : null;
  }

  async #loadEvents(): Promise<void> {
    const printer = this.#printer();
    if (!printer || !this.hub) return;
    try {
      const all = await this.hub.client.events(100);
      if (this.#printer()?.id === printer.id) this.events = all.filter((e) => e.printer === printer.id).slice(0, 20);
    } catch {
      this.events = null;
    }
  }

  override render(): TemplateResult {
    const hub = this.hub;
    if (!hub || !this.api) return html``;
    if (hub.status === 'unavailable') {
      return html`<section class="panel">
        <div class="panel-header"><span class="panel-title">${this.t('obico.api.title')}</span></div>
        <div class="panel-body"><p class="muted">${this.t('obico.api.unavailable')}</p></div>
      </section>`;
    }
    const printer = this.#printer();
    return html`${this.#renderConnection()} ${printer ? this.#renderReaction(printer) : nothing} ${printer ? this.#renderEvents() : nothing}`;
  }

  #renderConnection(): TemplateResult {
    const hub = this.hub!;
    const api = this.api!;
    const fallback = this.config?.serverUrl ?? '';
    const url = this.urlDraft ?? hub.url ?? fallback;
    const cloud = this.config?.isCloud ?? false;
    const linked = hub.obicoIdFor(api.printer.id);
    const printer = this.#printer();

    let state: TemplateResult;
    if (hub.status === 'ready') {
      state = printer
        ? html`<p class="ok">${this.t('obico.api.connected', { count: hub.printers.size, name: printer.name })}</p>`
        : linked === null
          ? html`<p class="warn">${this.t('obico.api.notLinked')}</p>`
          : html`<p class="warn">${this.t('obico.api.notFound')}</p>`;
    } else if (hub.status === 'error') {
      state = html`<p class="error">${this.t('obico.error', { error: hub.error.startsWith('obico.') ? this.t(hub.error) : hub.error })}</p>`;
    } else {
      state = html`<p class="muted">${this.t('obico.api.intro')}</p>`;
    }

    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.t('obico.api.title')}</span>
          <div class="panel-meta">
            <span class="chip ${hub.status === 'ready' ? 'live' : hub.status === 'error' ? 'bad' : ''}">
              ${this.t(`obico.api.status.${hub.status}`)}
            </span>
          </div>
        </div>
        <div class="panel-body">
          ${state}
          ${cloud ? html`<p class="warn">${this.t('obico.api.cloud')}</p>` : nothing}
          <div class="fields">
            <label class="field">
              <span>${this.t('obico.api.url')}</span>
              <input
                class="ltr"
                dir="ltr"
                type="url"
                inputmode="url"
                autocomplete="off"
                placeholder="http://192.168.1.20:3334"
                .value=${url}
                @input=${(e: Event) => (this.urlDraft = (e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="field">
              <span>${this.t('obico.api.token')}</span>
              <input
                class="ltr"
                dir="ltr"
                type="password"
                autocomplete="new-password"
                placeholder=${hub.hasSecret ? this.t('obico.api.tokenSaved') : ''}
                .value=${this.secretDraft}
                @input=${(e: Event) => (this.secretDraft = (e.target as HTMLInputElement).value)}
              />
            </label>
          </div>
          <p class="muted">
            ${this.t('obico.api.tokenHelp')}
            ${url ? html`<a class="ltr" dir="ltr" href=${tokenPageUrl(url.replace(/\/+$/, ''))} target="_blank" rel="noopener noreferrer">${this.t('obico.api.tokenPage')}</a>` : nothing}
          </p>
          <div class="row">
            <button
              class="primary"
              ?disabled=${this.busy || !url}
              @click=${() =>
                void this.#do(async () => {
                  await hub.configure(url.trim(), this.secretDraft ? this.secretDraft : undefined);
                  this.secretDraft = '';
                  this.urlDraft = null;
                  if (hub.status === 'error') throw new Error(hub.error.startsWith('obico.') ? this.t(hub.error) : hub.error);
                }, 'obico.api.saved')}
            >
              ${this.t('obico.api.save')}
            </button>
            <button ?disabled=${this.busy || hub.status === 'unconfigured'} @click=${() => void this.#do(() => hub.refresh(), 'obico.api.checked')}>
              ${this.t('obico.api.check')}
            </button>
            ${hub.url
              ? html`<button ?disabled=${this.busy} @click=${() => void this.#do(() => hub.forget(), 'obico.api.removed')}>
                  ${this.t('obico.api.remove')}
                </button>`
              : nothing}
          </div>
          ${this.notice ? html`<p class=${this.notice.kind} role="status">${this.notice.text}</p>` : nothing}
        </div>
      </section>
    `;
  }

  #renderReaction(printer: ObicoPrinter): TemplateResult {
    const hub = this.hub!;
    const v: ReactionSettings = { ...printer, ...this.draft };
    const set = (patch: Partial<ReactionSettings>) => (this.draft = { ...this.draft, ...patch });
    const num = (e: Event) => Number((e.target as HTMLInputElement).value);
    const checked = (e: Event) => (e.target as HTMLInputElement).checked;
    return html`
      <section class="panel">
        <div class="panel-header"><span class="panel-title">${this.t('obico.reaction.title')}</span></div>
        <div class="panel-body">
          <label class="check">
            <input type="checkbox" .checked=${v.watching_enabled} @change=${(e: Event) => set({ watching_enabled: checked(e) })} />
            <span>${this.t('obico.reaction.watching')}</span>
          </label>
          <div class="fields">
            <label class="field">
              <span>${this.t('obico.reaction.onFailure')}</span>
              <select @change=${(e: Event) => set({ action_on_failure: (e.target as HTMLSelectElement).value as 'PAUSE' | 'NONE' })}>
                <option value="PAUSE" ?selected=${v.action_on_failure === 'PAUSE'}>${this.t('obico.reaction.pause')}</option>
                <option value="NONE" ?selected=${v.action_on_failure === 'NONE'}>${this.t('obico.reaction.notifyOnly')}</option>
              </select>
            </label>
            <label class="field">
              <span>${this.t('obico.reaction.sensitivity', { value: v.detective_sensitivity.toFixed(2) })}</span>
              <input
                type="range"
                min="0.8"
                max="1.2"
                step="0.05"
                .value=${String(v.detective_sensitivity)}
                @input=${(e: Event) => set({ detective_sensitivity: num(e) })}
              />
            </label>
            <label class="field">
              <span>${this.t('obico.reaction.retract')}</span>
              <input type="number" min="0" step="0.5" .value=${String(v.retract_on_pause)} @change=${(e: Event) => set({ retract_on_pause: num(e) })} />
            </label>
            <label class="field">
              <span>${this.t('obico.reaction.liftZ')}</span>
              <input type="number" min="0" step="0.5" .value=${String(v.lift_z_on_pause)} @change=${(e: Event) => set({ lift_z_on_pause: num(e) })} />
            </label>
          </div>
          <label class="check">
            <input type="checkbox" .checked=${v.tools_off_on_pause} @change=${(e: Event) => set({ tools_off_on_pause: checked(e) })} />
            <span>${this.t('obico.reaction.toolsOff')}</span>
          </label>
          <label class="check">
            <input type="checkbox" .checked=${v.bed_off_on_pause} @change=${(e: Event) => set({ bed_off_on_pause: checked(e) })} />
            <span>${this.t('obico.reaction.bedOff')}</span>
          </label>
          <div class="row">
            <button
              class="primary"
              ?disabled=${this.busy || !this.draft}
              @click=${() =>
                void this.#do(async () => {
                  await hub.run((c) => c.patchPrinter(printer.id, this.draft ?? {}));
                  this.draft = null;
                }, 'obico.reaction.saved')}
            >
              ${this.t('obico.api.save')}
            </button>
            ${this.draft ? html`<button ?disabled=${this.busy} @click=${() => (this.draft = null)}>${this.t('obico.link.cancel')}</button>` : nothing}
          </div>
        </div>
      </section>
    `;
  }

  #renderEvents(): TemplateResult {
    const fmt = new Intl.DateTimeFormat(this.api!.i18n.locale, { dateStyle: 'short', timeStyle: 'short' });
    const list = this.events;
    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.t('obico.events.title')}</span>
          <div class="panel-meta"><button @click=${() => void this.#loadEvents()}>${this.t('obico.reload')}</button></div>
        </div>
        <div class="panel-body">
          ${list === null
            ? html`<p class="muted">${this.t('obico.loading')}</p>`
            : list.length === 0
              ? html`<p class="muted">${this.t('obico.events.empty')}</p>`
              : html`<ol class="events">
                  ${list.map(
                    (e) => html`<li>
                      <time datetime=${e.created_at}>${fmt.format(new Date(e.created_at))}</time>
                      <span>
                        <b class=${e.event_class}>${e.event_title || e.event_type}</b>
                        ${e.event_text ? html`<span class="muted">${stripTags(e.event_text)}</span>` : nothing}
                      </span>
                    </li>`,
                  )}
                </ol>`}
        </div>
      </section>
    `;
  }
}

/**
 * Event texts of Obico may carry simple HTML for its own web app; here they are plain text
 * (Lit escapes them anyway, this only drops the tags so they do not show).
 */
export function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
