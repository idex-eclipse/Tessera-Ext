import type { SurfaceProps } from '../element';
import { invalidateSpools, loadSpool } from '../spools';
import { effectiveTools, spoolIdForTool } from '../parse';
import { getPrinterState, reloadPrinter } from '../tracker';
import { useActivePrinter, useT } from './hooks';

const REFRESH_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

const OPEN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

/**
 * Widget header (manifest.json → widgets[].headerElement): the host places it
 * in the card header right of the title, with params = {}.
 */
export function WidgetHeader({ api }: SurfaceProps) {
  const t = useT(api);
  const printer = useActivePrinter(api);
  if (!printer.id) return null;

  async function refresh() {
    await reloadPrinter(printer.id);
    invalidateSpools(printer.id);
    const state = getPrinterState(printer.id);
    for (const tool of effectiveTools(state)) {
      const id = spoolIdForTool(state, tool);
      if (id != null) loadSpool(printer.id, id, true).catch(() => undefined);
    }
  }

  return (
    <div class="spm-header">
      <button type="button" class="spm-btn spm-icon-btn" title={t('spoolman.common.refresh')} aria-label={t('spoolman.common.refresh')} onClick={refresh}>
        {REFRESH_ICON}
      </button>
      {/* Plugin pages are routed as #/p/<printerId>/<pageId> (pageId from manifest.json). */}
      <a class="spm-btn spm-icon-btn" href={`#/p/${encodeURIComponent(printer.id)}/spoolman`} title={t('spoolman.widget.openPage')} aria-label={t('spoolman.widget.openPage')}>
        {OPEN_ICON}
      </a>
    </div>
  );
}
