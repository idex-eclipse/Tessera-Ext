import { css, html, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import type { PluginApi } from '../sdk';
import { DiagStore } from '../state';
import { styles } from './styles';

/**
 * One store for the page: the tab is mounted and unmounted as the user switches Machine
 * tabs, but a recording and its result must outlive that (see state.ts).
 */
let store: DiagStore | null = null;

function storeFor(api: PluginApi): DiagStore {
  // `moonraker()` follows the active printer, so the handle is resolved on every use.
  store ??= new DiagStore(() => api.moonraker());
  return store;
}

/**
 * <tessera-motion-diag-tab> - the Motion diagnostics tab of the Machine page.
 *
 * It contributes to the extension point `@core/system#tabs` (manifest.json). Three steps,
 * top to bottom, mirror what motan needs three tools for: record (data_logger.py), choose
 * what to draw (the dataset syntax of motan_graph.py), look at the graphs.
 */
export class MotionDiagTab extends TesseraElement {
  static override styles = [
    styles,
    css`
      details > summary {
        cursor: pointer;
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
      details ul {
        margin: var(--space-xs) 0 0;
        padding-inline-start: var(--space-lg);
        color: var(--text-secondary);
        font-size: var(--font-size-sm);
      }
    `,
  ];

  static override properties = {
    ...TesseraElement.properties,
    store: { state: true },
  };

  declare store: DiagStore | null;

  constructor() {
    super();
    this.store = null;
  }

  protected override attachApi(api: PluginApi): void {
    super.attachApi(api);
    const s = storeFor(api);
    s.bindPrinter(api.printer.id);
    this.store = s;
    // A capture belongs to one machine: switching printers drops it.
    this.track(api.onPrinterChange((p) => s.bindPrinter(p.id)));
  }

  override render(): TemplateResult {
    const { api, store } = this;
    if (!api || !store) return html``;
    return html`
      <details>
        <summary>${this.t('motiondiag.help.title')}</summary>
        <ul>
          <li>${this.t('motiondiag.help.record')}</li>
          <li>${this.t('motiondiag.help.graphs')}</li>
          <li>${this.t('motiondiag.help.bridge')}</li>
        </ul>
      </details>
      <tessera-md-capture .api=${api} .store=${store}></tessera-md-capture>
      <tessera-md-graphs-panel .api=${api} .store=${store}></tessera-md-graphs-panel>
      <tessera-md-graphs .api=${api} .store=${store}></tessera-md-graphs>
      <tessera-md-save .api=${api} .store=${store}></tessera-md-save>
      <tessera-md-dataset-dialog .api=${api} .store=${store}></tessera-md-dataset-dialog>
    `;
  }
}
