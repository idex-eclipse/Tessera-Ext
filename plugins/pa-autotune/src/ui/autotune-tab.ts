import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { keyed } from 'lit/directives/keyed.js';

import { TesseraElement } from '../base-element';
import { detectProviders, type Detection } from '../detect';
import { PROVIDERS, providerById, type Provider, type ProviderId } from '../providers';
import { SETTING_PROVIDER, pickProvider, settingUrl } from '../selection';
import { isMixedContent, normalizeManual, resolveUrl, type Resolved } from '../url';
import { styles } from './styles';

/**
 * What the provider's web UI may do inside our iframe. Scripts and same-origin
 * are needed by both SPAs (they talk to Moonraker on their own origin), forms
 * and downloads by their capture export, popups for their links to docs.
 */
const FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-modals';

/** Moonraker notifications after which the set of installed providers may have changed. */
const REDETECT_EVENTS = ['notify_klippy_ready', 'notify_config_changed'] as const;

const RELOAD_ICON = html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
</svg>`;

/**
 * <tessera-pa-autotune-tab> — our contribution to `@core/calibrations#tabs`.
 *
 * manifest.json:
 *   { "point": "@core/calibrations#tabs", "kind": "tab", "version": 1, … }
 *
 * - kind `tab`: we render the WHOLE content of a new tab; the tab button and
 *   its title (`titleKey`) are the owner's (Calibrations).
 * - no `available` export: the tab is always shown, so a printer without any
 *   provider gets installation instructions instead of a tab that is missing.
 *
 * Three states, decided by what Klipper knows (detect.ts):
 *   none   — no provider: instructions for each, "check again";
 *   one    — that provider's web UI in an iframe;
 *   several — the same with a switcher; the last choice is remembered.
 *
 * The web UI is a different site (nginx location of the provider), so the
 * frame is a direct browser → provider connection, not Moonraker's proxy: its
 * address is searched and checked in url.ts and can be typed by the user.
 *
 * Settings (`api.settingsFor(printerId)`, per printer): `provider`, `url.<provider id>`.
 */
export class PaAutotuneTab extends TesseraElement {
  static override styles = styles;

  static override properties = {
    ...TesseraElement.properties,
    detection: { state: true },
    checking: { state: true },
    providerId: { state: true },
    resolved: { state: true },
    resolving: { state: true },
    editing: { state: true },
    draft: { state: true },
    draftInvalid: { state: true },
    frameKey: { state: true },
  };

  declare detection: Detection | null;
  declare checking: boolean;
  declare providerId: ProviderId | null;
  declare resolved: Resolved | null;
  declare resolving: boolean;
  declare editing: boolean;
  declare draft: string;
  declare draftInvalid: boolean;
  declare frameKey: number;

  #bound = false;
  #offs: Array<() => void> = [];
  #offNotify: Array<() => void> = [];
  /** Keep requests and settings on the printer selected when this tab bound. */
  #printerId = '';
  /** Answers of an older query/probe must not overwrite a newer one. */
  #detectToken = 0;
  #resolveToken = 0;

  constructor() {
    super();
    this.detection = null;
    this.checking = false;
    this.providerId = null;
    this.resolved = null;
    this.resolving = false;
    this.editing = false;
    this.draft = '';
    this.draftInvalid = false;
    this.frameKey = 0;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // The host may re-attach a live element: willUpdate binds again.
    this.requestUpdate();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    if (this.api && this.isConnected && !this.#bound) this.#bind(this.api);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const off of this.#offs) off();
    this.#offs = [];
    this.#unsubscribeNotify();
    this.#bound = false;
    this.#printerId = '';
    this.#detectToken++;
    this.#resolveToken++;
  }

  // ------------------------------------------------------------------ state

  #bind(api: NonNullable<typeof this.api>): void {
    this.#bound = true;
    this.#offs.push(api.onPrinterChange(() => void this.#start()));
    this.#offs.push(api.onPrintersChange(() => {
      if (this.#printerId && !api.printers.some((printer) => printer.id === this.#printerId)) void this.#start();
    }));
    void this.#start();
  }

  /** Fresh state for the active printer. */
  async #start(): Promise<void> {
    // Invalidate unfinished work before it can publish another printer's result.
    this.#detectToken++;
    this.#resolveToken++;
    this.#printerId = this.api?.printer.id ?? '';
    this.detection = null;
    this.providerId = null;
    this.resolved = null;
    this.resolving = false;
    this.editing = false;
    this.#unsubscribeNotify();
    if (!this.#printerId) return;
    this.#subscribeNotify();
    await this.#detect(true);
  }

  #subscribeNotify(): void {
    try {
      const handle = this.api!.moonrakerFor(this.#printerId);
      for (const event of REDETECT_EVENTS) {
        this.#offNotify.push(handle.onNotify(event, () => void this.#detect(false)));
      }
    } catch {
      // No connection yet: the "Check again" button and a printer change still work.
    }
  }

  #unsubscribeNotify(): void {
    for (const off of this.#offNotify) off();
    this.#offNotify = [];
  }

  async #detect(initial: boolean): Promise<void> {
    const api = this.api;
    const printerId = this.#printerId;
    if (!api || !printerId) return;
    const mine = ++this.#detectToken;
    this.checking = true;
    let found: Detection;
    try {
      found = await detectProviders(api.moonrakerFor(printerId));
    } catch {
      found = { installed: [], hasLoadCell: false, unknown: true };
    }
    if (mine !== this.#detectToken) return;
    this.checking = false;
    // Klipper did not answer: keep what we already know instead of a false "nothing installed".
    if (found.unknown && this.detection) return;
    this.detection = found;

    const picked = pickProvider(found.installed, api.settingsFor(printerId).get(SETTING_PROVIDER));
    // The frame is reloaded only when the provider really changes (or on the first detection).
    if (initial || (picked?.id ?? null) !== this.providerId) {
      this.providerId = picked?.id ?? null;
      void this.#resolve();
    }
  }

  async #resolve(): Promise<void> {
    const api = this.api;
    const printerId = this.#printerId;
    const provider = this.providerId ? providerById(this.providerId) : undefined;
    const mine = ++this.#resolveToken;
    if (!api || !printerId || !provider) {
      this.resolved = null;
      this.resolving = false;
      return;
    }
    const printer = api.printers.find((item) => item.id === printerId);
    if (!printer) {
      this.resolved = null;
      this.resolving = false;
      return;
    }
    this.resolving = true;
    this.resolved = null;
    const result = await resolveUrl(provider, {
      manual: api.settingsFor(printerId).get<string>(settingUrl(provider.id)),
      pageOrigin: window.location.origin,
      printerUrl: printer.url,
    });
    if (mine !== this.#resolveToken) return;
    this.resolved = result;
    this.resolving = false;
    this.frameKey++;
  }

  // ---------------------------------------------------------------- actions

  /** Settings must stay on the printer whose provider is currently shown. */
  #settings() {
    return this.api && this.#printerId ? this.api.settingsFor(this.#printerId) : null;
  }

  #select(id: ProviderId): void {
    if (id === this.providerId) return;
    this.#settings()?.set(SETTING_PROVIDER, id);
    this.providerId = id;
    this.editing = false;
    void this.#resolve();
  }

  #toggleAddress(provider: Provider): void {
    this.editing = !this.editing;
    if (this.editing) {
      this.draft = this.#settings()?.get<string>(settingUrl(provider.id)) ?? '';
      this.draftInvalid = false;
    }
  }

  #saveAddress(provider: Provider): void {
    const value = this.draft.trim();
    if (value && !normalizeManual(value)) {
      this.draftInvalid = true;
      return;
    }
    this.#settings()?.set(settingUrl(provider.id), value || null);
    this.editing = false;
    void this.#resolve();
  }

  #resetAddress(provider: Provider): void {
    this.#settings()?.set(settingUrl(provider.id), null);
    this.draft = '';
    this.editing = false;
    void this.#resolve();
  }

  // ----------------------------------------------------------------- render

  override render(): TemplateResult | typeof nothing {
    if (!this.api) return nothing;
    if (!this.#printerId) return html`<div class="status">${this.t('paautotune.common.noPrinter')}</div>`;
    if (!this.detection) return html`<div class="status">${this.t('paautotune.common.loading')}</div>`;

    const provider = this.providerId ? providerById(this.providerId) : undefined;
    return provider ? this.#renderProvider(provider, this.detection) : this.#renderNone(this.detection);
  }

  #renderNone(detection: Detection): TemplateResult {
    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.t('paautotune.none.title')}</span>
          <button type="button" class="btn" ?disabled=${this.checking} @click=${() => void this.#detect(false)}>
            ${this.checking ? this.t('paautotune.none.checking') : this.t('paautotune.none.recheck')}
          </button>
        </div>
        <div class="panel-body">
          <p>${this.t('paautotune.none.intro')}</p>
          ${detection.unknown ? html`<p class="warn">${this.t('paautotune.common.klipperNotReady')}</p>` : nothing}
          ${!detection.unknown && !detection.hasLoadCell
            ? html`<p class="warn">${this.t('paautotune.none.noLoadCell')}</p>`
            : nothing}
          <p class="muted">${this.t('paautotune.none.stepCheck')}</p>
        </div>
      </section>
      ${PROVIDERS.map((p) => this.#renderInstructions(p))}
    `;
  }

  #renderInstructions(p: Provider): TemplateResult {
    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${p.name}</span>
          <a class="btn" href=${p.repoUrl} target="_blank" rel="noopener noreferrer">${this.t('paautotune.none.repo')}</a>
        </div>
        <div class="panel-body">
          <p class="muted">${this.t(`paautotune.provider.${p.id}`)}</p>
          <ol class="steps">
            <li>${this.t('paautotune.none.stepClone')}<code class="gcode">git clone ${p.cloneUrl}</code></li>
            <li>${this.t('paautotune.none.stepInstall')}<code class="gcode">cd ${p.cloneDir} &amp;&amp; ./install.sh</code></li>
            <li>${this.t('paautotune.none.stepConfig', { section: p.section })}</li>
            <li>${this.t('paautotune.none.stepRestart')}</li>
          </ol>
        </div>
      </section>
    `;
  }

  #renderProvider(provider: Provider, detection: Detection): TemplateResult {
    const resolved = this.resolved;
    const url = resolved?.url ?? null;
    const several = detection.installed.length > 1;

    return html`
      <section class="panel">
        <div class="panel-header">
          ${several
            ? html`<div class="sel-row" role="tablist">
                ${detection.installed.map((id) => {
                  const p = providerById(id)!;
                  return html`<button
                    type="button"
                    class="sel-btn ${id === provider.id ? 'active' : ''}"
                    role="tab"
                    aria-selected=${id === provider.id}
                    @click=${() => this.#select(id)}
                  >${p.name}</button>`;
                })}
              </div>`
            : html`<span class="panel-title">${provider.name}</span>`}
          ${several ? html`<span class="panel-title"></span>` : nothing}
          ${resolved?.manual ? html`<span class="chip accent">${this.t('paautotune.frame.custom')}</span>` : nothing}
          ${url ? html`<span class="chip mono" title=${url}>${url}</span>` : nothing}
          <button type="button" class="btn" ?disabled=${this.resolving} @click=${() => void this.#resolve()}
            title=${this.t('paautotune.frame.reload')} aria-label=${this.t('paautotune.frame.reload')}>${RELOAD_ICON}</button>
          <button type="button" class="btn ${this.editing ? 'primary' : ''}" @click=${() => this.#toggleAddress(provider)}>
            ${this.t('paautotune.frame.address')}
          </button>
          ${url
            ? html`<a class="btn" href=${url} target="_blank" rel="noopener noreferrer">${this.t('paautotune.frame.openTab')}</a>`
            : nothing}
        </div>
        ${this.editing ? this.#renderAddressEditor(provider) : nothing}
        <div class="panel-body">
          ${this.#renderFrame(provider, resolved)}
          <p class="muted">${this.t('paautotune.frame.hint')}</p>
          ${provider.id === 'kapat' ? html`<p class="muted">${this.t('paautotune.frame.kapatChart')}</p>` : nothing}
          <p class="muted">${this.t('paautotune.frame.guardNote')}</p>
        </div>
      </section>
    `;
  }

  #renderAddressEditor(provider: Provider): TemplateResult {
    const hasManual = Boolean(this.#settings()?.get<string>(settingUrl(provider.id)));
    return html`
      <div class="panel-body">
        <div class="row grow">
          <input
            type="url"
            class=${this.draftInvalid ? 'invalid' : ''}
            aria-label=${this.t('paautotune.frame.addressLabel')}
            placeholder=${this.t('paautotune.frame.addressPlaceholder', { path: provider.path })}
            .value=${this.draft}
            @input=${(e: Event) => {
              this.draft = (e.target as HTMLInputElement).value;
              this.draftInvalid = false;
            }}
            @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this.#saveAddress(provider)}
          />
          <button type="button" class="btn primary" @click=${() => this.#saveAddress(provider)}>
            ${this.t('paautotune.frame.save')}
          </button>
          ${hasManual
            ? html`<button type="button" class="btn" @click=${() => this.#resetAddress(provider)}>${this.t('paautotune.frame.reset')}</button>`
            : nothing}
        </div>
      </div>
    `;
  }

  #renderFrame(provider: Provider, resolved: Resolved | null): unknown {
    if (this.resolving || !resolved) {
      return html`<div class="status">${this.t('paautotune.frame.resolving', { name: provider.name })}</div>`;
    }
    if (!resolved.url) {
      return html`<div class="status">
        <p><b>${this.t('paautotune.frame.unreachableTitle', { name: provider.name })}</b></p>
        <p>${this.t('paautotune.frame.unreachableBody', { tried: resolved.tried.join(', ') })}</p>
      </div>`;
    }
    if (isMixedContent(resolved.url, window.location.protocol)) {
      return html`<div class="status">
        <p><b>${this.t('paautotune.frame.mixedTitle')}</b></p>
        <p>${this.t('paautotune.frame.mixedBody', { name: provider.name })}</p>
      </div>`;
    }
    return keyed(
      this.frameKey,
      html`<iframe
        class="frame"
        title=${provider.name}
        src=${resolved.url}
        sandbox=${FRAME_SANDBOX}
        referrerpolicy="no-referrer"
        allow="clipboard-write"
      ></iframe>`,
    );
  }
}
