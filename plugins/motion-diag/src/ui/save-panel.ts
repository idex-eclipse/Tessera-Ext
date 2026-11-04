import { html, nothing, type TemplateResult } from 'lit';

import { StoreElement } from '../base-element';
import type { GraphView } from './graph-view';
import { downloadBlob, fileBaseName } from './download';
import { styles } from './styles';

/**
 * <tessera-md-save> - take the data out of the browser.
 *
 * - the capture as a motan log (`dump.json.gz` + `dump.index.gz` in one `.tar.gz`), which
 *   real motan reads (`motan_graph.py dump`) and this tab opens again;
 * - the graphs as one PNG picture (axes, titles and legends included), as they are on screen;
 * - the computed graphs as a CSV table, laid out like motan's `data_export.py`.
 */
export class SavePanel extends StoreElement {
  static override styles = [styles];

  declare busy: boolean;

  static override properties = {
    ...StoreElement.properties,
    busy: { state: true },
  };

  constructor() {
    super();
    this.busy = false;
  }

  #base(): string {
    return fileBaseName(this.api?.printer.name ?? '');
  }

  async #saveMotan(): Promise<void> {
    this.busy = true;
    try {
      // Inside the archive the files are called "dump", so `motan_graph.py dump` works as soon as it is unpacked.
      const blob = await this.store!.exportMotan('dump');
      if (blob) downloadBlob(blob, `${this.#base()}.tar.gz`);
    } finally {
      this.busy = false;
    }
  }

  /** The charts element next to us in the tab. */
  #graphs(): GraphView | null {
    return (this.getRootNode() as ShadowRoot | Document).querySelector<GraphView>('tessera-md-graphs');
  }

  async #savePng(): Promise<void> {
    const graphs = this.#graphs();
    const st = this.store!.state;
    if (!graphs?.canExportPng) return;
    this.busy = true;
    try {
      const w = st.computed?.window ?? st.window;
      const step = +(w.segmentTime * 1000).toFixed(4);
      const title = `${this.t('motiondiag.tabTitle')} - ${this.api?.printer.name ?? ''}`.replace(/ - $/, '');
      const subtitle = this.t('motiondiag.save.pngSubtitle', {
        date: new Date().toLocaleString(this.api?.i18n.locale),
        from: w.skip,
        len: w.duration,
        step,
      });
      const blob = await graphs.exportPng(title, subtitle, (n) => this.t('motiondiag.graphs.rowTitle', { n }));
      downloadBlob(blob, `${this.#base()}.png`);
    } finally {
      this.busy = false;
    }
  }

  #saveCsv(): void {
    const csv = this.store!.exportCsv();
    if (csv) downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${this.#base()}.csv`);
  }

  override render(): TemplateResult | typeof nothing {
    const store = this.store;
    const st = store?.state;
    if (!store || !st?.capture) return nothing;
    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${this.t('motiondiag.save.title')}</span>
        </div>
        <div class="panel-body">
          <div class="row">
            <button ?disabled=${this.busy} @click=${() => void this.#saveMotan()}>${this.t('motiondiag.save.motan')}</button>
            <span class="muted grow">${this.t('motiondiag.save.motanHint')}</span>
          </div>
          <div class="row">
            <button ?disabled=${!st.computed || this.busy} @click=${() => void this.#savePng()}>${this.t('motiondiag.save.png')}</button>
            <span class="muted grow">${this.t(st.computed ? 'motiondiag.save.pngHint' : 'motiondiag.save.csvNeedsGraphs')}</span>
          </div>
          <div class="row">
            <button ?disabled=${!st.computed} @click=${() => this.#saveCsv()}>${this.t('motiondiag.save.csv')}</button>
            <span class="muted grow">${this.t(st.computed ? 'motiondiag.save.csvHint' : 'motiondiag.save.csvNeedsGraphs')}</span>
          </div>
        </div>
      </section>
    `;
  }
}
