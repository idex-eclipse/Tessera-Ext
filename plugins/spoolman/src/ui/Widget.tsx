import type { SurfaceProps } from '../element';
import { pickerRequest } from '../guard';
import { effectiveTools, spoolIdForTool } from '../parse';
import type { PluginApi } from '../sdk';
import { useSpool } from '../spools';
import { printerStates } from '../tracker';
import type { PrinterSpoolState } from '../types';
import { useActivePrinter, useT } from './hooks';
import { SpoolLine } from './SpoolLine';

/**
 * Dashboard widget body (manifest.json → widgets[].element).
 *
 * The host draws the card and its title (titleKey); we render the content.
 * A dashboard belongs to the ACTIVE printer, so the widget follows
 * api.printer and re-renders on onPrinterChange (useActivePrinter).
 * Data comes from the module-level tracker, not from per-widget requests:
 * several widgets/surfaces share one subscription per printer.
 */
export function Widget({ api }: SurfaceProps) {
  const t = useT(api);
  const printer = useActivePrinter(api);

  if (!printer.id) return <div class="spm-root"><p class="spm-muted">{t('spoolman.common.noPrinter')}</p></div>;

  const state = printerStates.value[printer.id];
  if (!state?.ready) return <div class="spm-root"><p class="spm-muted">{t('spoolman.common.loading')}</p></div>;
  if (!state.hasSpoolman) return <div class="spm-root"><p class="spm-muted">{t('spoolman.common.notConfigured')}</p></div>;

  const tools = effectiveTools(state);
  return (
    <div class="spm-root">
      {state.connected === false && <p class="spm-warn">{t('spoolman.common.disconnected')}</p>}
      <div class="spm-tools">
        {tools.map((tool) => (
          <ToolCard key={tool} api={api} printerId={printer.id} state={state} tool={tool} showLabel={state.tools.length > 1} />
        ))}
      </div>
    </div>
  );
}

function ToolCard(props: { api: PluginApi; printerId: string; state: PrinterSpoolState; tool: string; showLabel: boolean }) {
  const { api, printerId, state, tool, showLabel } = props;
  const t = useT(api);
  const spool = useSpool(printerId, spoolIdForTool(state, tool));

  return (
    <div class="spm-tool">
      {showLabel && <span class="spm-tool-label">{tool}</span>}
      <SpoolLine t={t} spool={spool} />
      {/* The picker lives in the always-mounted overlay so it can float above
          the dashboard; the widget only asks for it through a signal. */}
      <button type="button" class="spm-btn" onClick={() => (pickerRequest.value = { printerId, tool })}>
        {t('spoolman.widget.change')}
      </button>
    </div>
  );
}
