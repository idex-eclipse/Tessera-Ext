import { html, nothing, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import { logFileRef, obicoPrinterUrl, tesseraPort, tunnelSnippet } from '../core/config';
import { fetchLogTail, ObicoState } from '../core/state';
import type { PluginApi } from '../sdk';
import { styles } from './styles';

/** Obico's own setup guide for Klipper, shown when the agent is not installed. */
const SETUP_DOCS = 'https://www.obico.io/docs/user-guides/klipper-setup/';

/** What the log box shows: nothing yet, the text, or why there is none. */
type LogView = { kind: 'hidden' } | { kind: 'loading' } | { kind: 'text'; text: string } | { kind: 'message'; text: string };

/**
 * <tessera-obico-tab> - the Obico tab of the Machine page.
 *
 * It contributes to the extension point `@core/system#tabs` (manifest.json) and is shown on
 * every printer: without the agent it says how to install it. The panels drawn here come
 * from Moonraker (the agent's config, service, macros and DB entry), so they work the same
 * with Obico Cloud and a self-hosted server. The panels that need the Obico API
 * (connection, reaction settings, events) are <tessera-obico-api> (api-panels.ts).
 */
export class ObicoTab extends TesseraElement {
  static override styles = [styles];

  static override properties = {
    ...TesseraElement.properties,
    snap: { state: true },
    busy: { state: true },
    confirmRelink: { state: true },
    notice: { state: true },
    log: { state: true },
  };

  declare snap: ObicoState['snapshot'] | null;
  declare busy: boolean;
  declare confirmRelink: boolean;
  /** One line under the panels: the result or the error of the last action. */
  declare notice: { kind: 'ok' | 'error'; text: string } | null;
  declare log: LogView;

  #state: ObicoState | null = null;
  /** The visible tab's target is stable during asynchronous log requests. */
  #printerId = '';
  #unsub: (() => void) | null = null;

  constructor() {
    super();
    this.snap = null;
    this.busy = false;
    this.confirmRelink = false;
    this.notice = null;
    this.log = { kind: 'hidden' };
  }

  protected override attachApi(api: PluginApi): void {
    super.attachApi(api);
    this.#bind(api);
    // A printer switch keeps the tab mounted: rebuild the model for the new printer.
    this.track(api.onPrinterChange(() => this.#bind(api)));
    this.track(api.onPrintersChange(() => {
      if (this.#printerId && !api.printers.some((printer) => printer.id === this.#printerId)) this.#bind(api);
    }));
    this.track(() => this.#release());
  }

  #bind(api: PluginApi): void {
    this.#release();
    this.confirmRelink = false;
    this.notice = null;
    this.log = { kind: 'hidden' };
    this.#printerId = api.printer.id;
    if (!this.#printerId) {
      this.snap = null;
      return;
    }
    const state = new ObicoState(api.moonrakerFor(this.#printerId));
    this.#state = state;
    this.snap = state.snapshot;
    this.#unsub = state.subscribe(() => {
      this.snap = state.snapshot;
    });
  }

  #release(): void {
    this.#unsub?.();
    this.#unsub = null;
    this.#state?.dispose();
    this.#state = null;
  }

  /** Runs an action with the buttons disabled; its result or error goes to the notice line. */
  async #run(action: () => Promise<void>, okKey: string): Promise<void> {
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

  async #loadLog(): Promise<void> {
    const state = this.#state;
    const api = this.api;
    if (!state || !api) return;
    const logPath = state.snapshot.config?.logPath ?? '';
    const ref = logFileRef(logPath);
    if (!ref) {
      this.log = { kind: 'message', text: this.t('obico.service.logOutside', { path: logPath }) };
      return;
    }
    this.log = { kind: 'loading' };
    try {
      const text = await fetchLogTail(api.moonrakerFor(this.#printerId), ref);
      if (state !== this.#state) return;
      if (text === null) this.log = { kind: 'message', text: this.t('obico.service.logMissing') };
      else if (!text.trim()) this.log = { kind: 'message', text: this.t('obico.service.logEmpty') };
      else this.log = { kind: 'text', text };
    } catch (e) {
      if (state !== this.#state) return;
      this.log = { kind: 'message', text: this.t('obico.error', { error: e instanceof Error ? e.message : String(e) }) };
    }
  }

  override updated(): void {
    // Keep the newest log lines in view, like a terminal.
    const pre = this.renderRoot.querySelector('pre.log');
    if (pre) pre.scrollTop = pre.scrollHeight;
  }

  override render(): TemplateResult {
    const s = this.snap;
    if (!s || s.loading) return html`<p class="muted">${this.t('obico.loading')}</p>`;
    if (!s.installed) return this.#renderMissing();
    // The API panels sit right after the link: failure detection is what the tab is for.
    return html`
      ${this.#renderLink(s)}
      <tessera-obico-api .api=${this.api} .config=${s.config}></tessera-obico-api>
      ${this.#renderService(s)} ${this.#renderTunnel(s)}
      ${this.notice ? html`<p class=${this.notice.kind} role="status">${this.notice.text}</p>` : nothing}
    `;
  }

  #renderMissing(): TemplateResult {
    return html`
      <section class="panel">
        <div class="panel-header"><span class="panel-title">${this.t('obico.missing.title')}</span></div>
        <div class="panel-body">
          <p>${this.t('obico.missing.text')}</p>
          <div class="row">
            <button @click=${() => void this.#state?.reload()}>${this.t('obico.reload')}</button>
            <a class="button" href=${SETUP_DOCS} target="_blank" rel="noopener noreferrer">${this.t('obico.missing.docs')}</a>
          </div>
        </div>
      </section>
    `;
  }

  #renderLink(s: ObicoState['snapshot']): TemplateResult {
    const cfg = s.config;
    const { linked, passcode, passlink } = s.link;
    const chip =
      linked === true
        ? html`<span class="chip live">${this.t('obico.link.linked')}</span>`
        : linked === false
          ? html`<span class="chip warn">${this.t('obico.link.notLinked')}</span>`
          : html`<span class="chip">${this.t('obico.link.unknown')}</span>`;
    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.t('obico.link.title')}</span>
          <div class="panel-meta">
            ${cfg ? html`<span class="chip">${this.t(cfg.isCloud ? 'obico.link.cloud' : 'obico.link.selfHosted')}</span>` : nothing}
            ${chip}
          </div>
        </div>
        <div class="panel-body">
          ${cfg
            ? html`<div class="row">
                <span class="label">${this.t('obico.link.server')}</span>
                <span class="ltr" dir="ltr">${cfg.serverUrl}</span>
              </div>`
            : nothing}
          ${linked === false ? this.#renderLinkCode(passcode, passlink, s) : nothing}
          <div class="row">
            ${linked === true && cfg
              ? html`<a class="button primary" href=${obicoPrinterUrl(cfg.serverUrl, s.printerId)} target="_blank" rel="noopener noreferrer"
                  >${this.t('obico.link.open')}</a
                >`
              : nothing}
            ${linked === true && s.canRelink && !this.confirmRelink
              ? html`<button ?disabled=${this.busy} @click=${() => (this.confirmRelink = true)}>${this.t('obico.link.relink')}</button>`
              : nothing}
            <button ?disabled=${this.busy} @click=${() => void this.#state?.reload()}>${this.t('obico.reload')}</button>
          </div>
          ${this.confirmRelink
            ? html`<div class="confirm" role="alertdialog">
                <p>${this.t('obico.link.relinkConfirm')}</p>
                <div class="row">
                  <button
                    class="danger"
                    ?disabled=${this.busy}
                    @click=${() => {
                      this.confirmRelink = false;
                      void this.#run(() => this.#state!.relink(), 'obico.link.relinkDone');
                    }}
                  >
                    ${this.t('obico.link.confirm')}
                  </button>
                  <button @click=${() => (this.confirmRelink = false)}>${this.t('obico.link.cancel')}</button>
                </div>
              </div>`
            : nothing}
        </div>
      </section>
    `;
  }

  /** Not linked: the code the agent issued, or why it is not shown. */
  #renderLinkCode(passcode: string, passlink: string, s: ObicoState['snapshot']): TemplateResult {
    if (passcode) {
      return html`
        <div class="row">
          <span class="label">${this.t('obico.link.code')}</span>
          <span class="code ltr" dir="ltr">${passcode}</span>
        </div>
        <p class="muted">${this.t('obico.link.codeHint')}</p>
        ${passlink
          ? html`<div class="row">
              <a class="button primary" href=${passlink} target="_blank" rel="noopener noreferrer">${this.t('obico.link.openCode')}</a>
            </div>`
          : nothing}
      `;
    }
    // Without the macro the code exists only in the agent's log.
    return html`<p class="muted">${this.t(s.canRelink ? 'obico.link.waiting' : 'obico.link.noMacros')}</p>`;
  }

  #renderService(s: ObicoState['snapshot']): TemplateResult {
    const svc = s.service;
    const running = svc?.active === 'active';
    const shown = this.log.kind !== 'hidden';
    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.t('obico.service.title')}</span>
          ${svc
            ? html`<div class="panel-meta">
                <span class="ltr" dir="ltr">${svc.name}</span>
                <span class="chip ${running ? 'live' : 'bad'}" dir="ltr">${svc.sub || svc.active || '?'}</span>
              </div>`
            : nothing}
        </div>
        <div class="panel-body">
          ${svc ? nothing : html`<p class="muted">${this.t('obico.service.unmanaged')}</p>`}
          <div class="row">
            ${svc
              ? html`<button ?disabled=${this.busy} @click=${() => void this.#run(() => this.#state!.restartService(), 'obico.service.restarted')}>
                  ${this.t('obico.service.restart')}
                </button>`
              : nothing}
            <button
              aria-expanded=${shown ? 'true' : 'false'}
              @click=${() => {
                if (shown) this.log = { kind: 'hidden' };
                else void this.#loadLog();
              }}
            >
              ${this.t(shown ? 'obico.service.hideLog' : 'obico.service.showLog')}
            </button>
            ${shown ? html`<button @click=${() => void this.#loadLog()}>${this.t('obico.service.refreshLog')}</button>` : nothing}
          </div>
          ${this.#renderLog()}
        </div>
      </section>
    `;
  }

  #renderLog(): TemplateResult | typeof nothing {
    switch (this.log.kind) {
      case 'hidden':
        return nothing;
      case 'loading':
        return html`<p class="muted">${this.t('obico.loading')}</p>`;
      case 'message':
        return html`<p class="muted">${this.log.text}</p>`;
      case 'text':
        return html`<pre class="log" dir="ltr" tabindex="0">${this.log.text}</pre>`;
    }
  }

  #renderTunnel(s: ObicoState['snapshot']): TemplateResult {
    const cfg = s.config;
    let body: TemplateResult;
    if (!cfg) {
      body = html`<p class="muted">${this.t('obico.tunnel.noConfig')}</p>`;
    } else {
      const { host, port, ssl } = cfg.tunnel;
      const target = `${ssl ? 'https' : 'http'}://${host}:${port}`;
      const ours = tesseraPort(window.location);
      body = html`
        <p class="muted">${this.t('obico.tunnel.intro')}</p>
        <div class="row">
          <span class="label">${this.t('obico.tunnel.target')}</span>
          <span class="ltr" dir="ltr">${target}</span>
        </div>
        ${ours === null
          ? html`<p class="muted">${this.t('obico.tunnel.unknownPort')}</p>`
          : port === ours && !ssl
            ? html`<p class="ok">${this.t('obico.tunnel.ok')}</p>`
            : html`<p class="warn">${this.t('obico.tunnel.other')}</p>
                <pre class="snippet" dir="ltr">${tunnelSnippet(ours)}</pre>`}
      `;
    }
    return html`
      <section class="panel">
        <div class="panel-header"><span class="panel-title">${this.t('obico.tunnel.title')}</span></div>
        <div class="panel-body">${body}</div>
      </section>
    `;
  }
}
