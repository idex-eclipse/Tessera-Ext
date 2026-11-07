import { css, html, nothing, type TemplateResult } from 'lit';

import { HubElement } from '../base-element';
import type { PendingAlert } from '../core/hub';
import type { PluginApi } from '../sdk';
import { styles } from './styles';
import { meter, meterStyles } from './parts';

/** Alerts already announced in the notification center during this page's life. */
const announced = new Set<string>();

/**
 * <tessera-obico-overlay> - the listener and the alert window in one element.
 *
 * Overlays are always mounted (docs/en/surfaces.md §4), so this element is what keeps the
 * Obico hub polling on every page. It renders nothing until a Tessera printer has an
 * alert nobody answered; then it pushes a critical notification (with sound, if the user
 * enabled it) and shows the window on top of whatever page is open.
 *
 * Answers:
 * - "Not a failure" records the verdict in Obico (it learns from it) and, when the printer
 *   is paused, resumes it; optionally stops watching the rest of the print;
 * - "Cancel print" asks once more, cancels through Moonraker (so Tessera's guards see it)
 *   and records "it was a failure";
 * - "Later" closes the window for this alert in this page; it stays unanswered in Obico.
 */
export class ObicoOverlay extends HubElement {
  static override styles = [
    styles,
    meterStyles,
    css`
      :host {
        display: contents;
      }
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgb(0 0 0 / 0.45);
        display: grid;
        place-items: center;
        /* 16px gutter so the dialog never touches the screen edge on a phone. */
        padding: 16px;
      }
      .dialog {
        inline-size: min(520px, 100%);
        max-block-size: calc(100dvh - 32px);
        overflow: auto;
        border-color: var(--danger);
      }
      .dialog .panel-header {
        color: var(--danger);
      }
      tessera-obico-snapshot {
        block-size: min(40dvh, 280px);
      }
      label.check {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-block-size: 32px;
      }
    `,
  ];

  static override properties = {
    ...HubElement.properties,
    busy: { state: true },
    confirmCancel: { state: true },
    muteToo: { state: true },
    failure: { state: true },
  };

  declare busy: boolean;
  declare confirmCancel: boolean;
  declare muteToo: boolean;
  declare failure: string;
  /** The alert the window shows; a new one resets the window's own state. */
  #shown = '';

  constructor() {
    super();
    this.busy = false;
    this.confirmCancel = false;
    this.muteToo = false;
    this.failure = '';
  }

  protected override attachApi(api: PluginApi): void {
    super.attachApi(api);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' && this.#current() && !this.busy) this.hub?.dismiss(this.#current()!.key);
    };
    window.addEventListener('keydown', onKey);
    this.track(() => window.removeEventListener('keydown', onKey));
  }

  #current(): PendingAlert | null {
    return this.hub?.pendingAlerts()[0] ?? null;
  }

  #printerName(tesseraId: string): string {
    return this.api?.printers.find((p) => p.id === tesseraId)?.name ?? tesseraId;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    super.willUpdate(changed);
    const api = this.api;
    const hub = this.hub;
    if (!api || !hub) return;
    for (const a of hub.pendingAlerts()) {
      if (announced.has(a.key)) continue;
      announced.add(a.key);
      api.notifications.push({
        severity: 'critical',
        text: this.t('obico.alert.notify', { printer: this.#printerName(a.tesseraId) }),
        label: this.t('obico.tabTitle'),
        printerId: a.tesseraId,
      });
    }
    const key = this.#current()?.key ?? '';
    if (key !== this.#shown) {
      this.#shown = key;
      this.confirmCancel = false;
      this.muteToo = false;
      this.failure = '';
    }
  }

  /** Runs the steps in order; a refused step (a guard, the server) stops and leaves the alert open. */
  async #act(steps: Array<() => Promise<unknown>>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.failure = '';
    try {
      for (const step of steps) await step();
      await this.hub!.poll();
    } catch (e) {
      this.failure = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }

  #notFailure(alert: PendingAlert): void {
    const api = this.api!;
    const hub = this.hub!;
    const id = alert.printer.id;
    const paused = alert.printer.status?.state?.flags?.paused === true;
    const steps: Array<() => Promise<unknown>> = [() => hub.client.acknowledge(id, 'NOT_FAILED')];
    if (this.muteToo) steps.push(() => hub.client.mute(id));
    // Obico paused it on the alert: resume through Moonraker, where the guards are.
    if (paused) steps.push(() => api.moonrakerFor(alert.tesseraId).request('printer.print.resume'));
    void this.#act(steps);
  }

  #cancel(alert: PendingAlert): void {
    const api = this.api!;
    const hub = this.hub!;
    void this.#act([
      () => api.moonrakerFor(alert.tesseraId).request('printer.print.cancel'),
      () => hub.client.acknowledge(alert.printer.id, 'FAILED'),
    ]);
  }

  override render(): TemplateResult | typeof nothing {
    const alert = this.#current();
    const api = this.api;
    if (!alert || !api) return nothing;
    const printer = alert.printer;
    const paused = printer.status?.state?.flags?.paused === true;
    return html`
      <div class="backdrop">
        <section class="panel dialog" role="alertdialog" aria-modal="true" aria-labelledby="obico-alert-title">
          <div class="panel-header">
            <span class="panel-title" id="obico-alert-title">
              ${this.t('obico.alert.title', { printer: this.#printerName(alert.tesseraId) })}
            </span>
          </div>
          <div class="panel-body">
            <p>${this.t(paused ? 'obico.alert.textPaused' : 'obico.alert.text')}</p>
            ${printer.current_print?.filename
              ? html`<p class="muted ltr" dir="ltr">${printer.current_print.filename}</p>`
              : nothing}
            ${meter(this.t, printer)}
            <tessera-obico-snapshot .api=${api} .src=${printer.pic?.img_url ?? null}></tessera-obico-snapshot>
            ${this.failure ? html`<p class="error" role="alert">${this.t('obico.error', { error: this.failure })}</p>` : nothing}
            ${this.confirmCancel
              ? html`<div class="confirm">
                  <p>${this.t('obico.alert.cancelConfirm')}</p>
                  <div class="row">
                    <button class="danger" ?disabled=${this.busy} @click=${() => this.#cancel(alert)}>
                      ${this.t('obico.alert.cancelYes')}
                    </button>
                    <button ?disabled=${this.busy} @click=${() => (this.confirmCancel = false)}>${this.t('obico.link.cancel')}</button>
                  </div>
                </div>`
              : html`
                  <label class="check">
                    <input type="checkbox" .checked=${this.muteToo} @change=${(e: Event) => (this.muteToo = (e.target as HTMLInputElement).checked)} />
                    <span>${this.t('obico.alert.muteToo')}</span>
                  </label>
                  <div class="row">
                    <button class="primary" ?disabled=${this.busy} @click=${() => this.#notFailure(alert)}>
                      ${this.t(paused ? 'obico.alert.notFailureResume' : 'obico.alert.notFailure')}
                    </button>
                    <button class="danger" ?disabled=${this.busy} @click=${() => (this.confirmCancel = true)}>
                      ${this.t('obico.alert.cancel')}
                    </button>
                    <button ?disabled=${this.busy} @click=${() => this.hub!.dismiss(alert.key)}>${this.t('obico.alert.later')}</button>
                  </div>
                `}
          </div>
        </section>
      </div>
    `;
  }
}
