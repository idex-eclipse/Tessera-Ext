import { css, html, nothing, type TemplateResult } from 'lit';

import { StoreElement } from '../base-element';
import type { SourceKind } from '../core/discovery';
import type { PluginApi } from '../sdk';
import { styles } from './styles';

const KIND_ORDER: SourceKind[] = ['trapq', 'stepq', 'accelerometer', 'angle', 'ldc1612', 'loadcell', 'stallguard'];

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * <tessera-md-capture> - choose what to record and record it.
 *
 * It replaces data_logger.py: the sources come from the printer instead of glob patterns,
 * the recording is started and stopped with a button, and the result stays in the browser.
 */
export class CapturePanel extends StoreElement {
  static override styles = [
    styles,
    css`
      /* One bordered box per kind of source; the items wrap by the container width. */
      .group {
        margin: 0;
        padding: var(--space-xs) var(--space-sm) var(--space-sm);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        min-width: 0;
      }
      legend {
        padding-inline: var(--space-xs);
        font-size: var(--font-size-sm);
        font-weight: 600;
      }
      .items {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: var(--space-xs) var(--space-md);
      }
      .check {
        display: inline-flex;
        align-items: center;
        gap: var(--space-xs);
        min-block-size: 32px;
        font-size: var(--font-size-sm);
        cursor: pointer;
      }
      .item span {
        min-width: 0;
      }
    `,
  ];

  protected override attachApi(api: PluginApi): void {
    super.attachApi(api);
    // Look for sources once, when the tab first appears.
    const store = this.store;
    if (store && store.state.discover === 'idle') void store.refreshSources();
  }

  async #open(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    // Reset, so that choosing the same file again fires `change` again.
    input.value = '';
    if (picked.length === 0) return;
    const files = await Promise.all(picked.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    await this.store!.openFiles(files);
  }

  override render(): TemplateResult | typeof nothing {
    const store = this.store;
    if (!store) return nothing;
    const st = store.state;
    const recording = store.recording;

    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.t('motiondiag.capture.title')}</span>
          <button class="small" ?disabled=${recording || st.discover === 'loading'} @click=${() => void store.refreshSources()}>
            ${this.t('motiondiag.capture.refresh')}
          </button>
          <button class="small" ?disabled=${recording} @click=${() => this.renderRoot.querySelector<HTMLInputElement>('#open')!.click()}>
            ${this.t('motiondiag.capture.open')}
          </button>
          <!-- A saved capture: the .tar.gz of this tab or motan's .json.gz + .index.gz pair (both selected together). -->
          <input id="open" type="file" multiple hidden accept=".gz,.tgz,application/gzip" @change=${(e: Event) => void this.#open(e)} />
        </div>
        <div class="panel-body">
          ${st.openError ? html`<p class="error">${this.t('motiondiag.capture.openError', { reason: st.openError })}</p>` : nothing}
          ${this.#sources()}
          <div class="row">
            <label class="field">
              <span class="field-label">${this.t('motiondiag.capture.maxSeconds')}</span>
              <input
                class="ltr"
                type="number"
                min="1"
                step="1"
                .value=${String(st.maxSeconds)}
                ?disabled=${recording}
                @change=${(e: Event) => store.setMaxSeconds(Number((e.target as HTMLInputElement).value))}
              />
            </label>
            <span class="grow"></span>
            ${recording
              ? html`<button class="danger" @click=${() => store.stopRecording()}>${this.t('motiondiag.capture.stop')}</button>`
              : html`<button
                  class="primary"
                  ?disabled=${st.selected.size === 0 || st.discover !== 'ready'}
                  @click=${() => void store.startRecording()}
                >
                  ${this.t(st.capture ? 'motiondiag.capture.again' : 'motiondiag.capture.start')}
                </button>`}
          </div>
          ${this.#status()}
        </div>
      </section>
    `;
  }

  #sources(): TemplateResult {
    const store = this.store!;
    const st = store.state;
    if (st.discover === 'loading') return html`<p class="muted">${this.t('motiondiag.capture.loading')}</p>`;
    if (st.discover === 'error') {
      return html`<p class="error">${this.t('motiondiag.capture.discoverError', { reason: st.discoverError })}</p>`;
    }
    if (st.sources.length === 0) return html`<p class="muted">${this.t('motiondiag.capture.noSources')}</p>`;
    const recording = store.recording;

    return html`${KIND_ORDER.map((kind) => {
      const group = st.sources.filter((s) => s.kind === kind);
      if (group.length === 0) return nothing;
      const ids = group.map((s) => s.id);
      const all = ids.every((id) => st.selected.has(id));
      return html`
        <fieldset class="group">
          <legend>
            <label class="check">
              <input
                type="checkbox"
                .checked=${all}
                ?disabled=${recording}
                @change=${(e: Event) => store.setSelected(ids, (e.target as HTMLInputElement).checked)}
              />
              ${this.t(`motiondiag.kind.${kind}`)}
            </label>
          </legend>
          <div class="items">
            ${group.map(
              (s) => html`<label class="check item" title=${s.section || s.method}>
                <input
                  type="checkbox"
                  .checked=${st.selected.has(s.id)}
                  ?disabled=${recording}
                  @change=${(e: Event) => store.setSelected([s.id], (e.target as HTMLInputElement).checked)}
                />
                <span class="ltr">${s.name}</span>
              </label>`,
            )}
          </div>
        </fieldset>
      `;
    })}`;
  }

  #status(): TemplateResult | typeof nothing {
    const st = this.store!.state;
    const snap = st.snapshot;
    if (!snap) return html`<p class="muted">${this.t('motiondiag.capture.hint')}</p>`;
    const stateKey = `motiondiag.capture.state.${snap.state}`;
    return html`
      <div class="row">
        <span class="chip ${snap.state === 'recording' ? 'live' : snap.state === 'failed' ? 'bad' : ''}">${this.t(stateKey)}</span>
        <span class="muted ltr">${snap.elapsed.toFixed(1)} s</span>
        <span class="muted ltr">${formatBytes(snap.approxBytes)}</span>
        ${st.capture && !this.store!.recording
          ? html`<span class="grow"></span
              ><button class="small" @click=${() => this.store!.discardCapture()}>${this.t('motiondiag.capture.discard')}</button>`
          : nothing}
      </div>
      ${snap.reason ? html`<p class=${snap.state === 'failed' ? 'error' : 'muted'}>${snap.reason}</p>` : nothing}
      <div class="row">
        ${snap.sources.map(
          (s) => html`<span class="chip ltr ${s.status === 'live' ? 'live' : s.status === 'unavailable' ? 'bad' : ''}"
            >${s.id} · ${s.messages}</span
          >`,
        )}
      </div>
    `;
  }
}
