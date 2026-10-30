import { useState } from 'preact/hooks';

import { materialFor, type Issue } from '../check';
import type { SurfaceProps } from '../element';
import { pendingChecks, pickerRequest, recheck, resolveCheck, type PendingCheck } from '../guard';
import { spoolIdForTool } from '../parse';
import type { PluginApi } from '../sdk';
import { useSpool } from '../spools';
import { printerStates } from '../tracker';
import { emptyPrinterState } from '../types';
import { useT } from './hooks';
import { issueText, SpoolLine } from './SpoolLine';
import { SpoolPicker } from './SpoolPicker';

/**
 * Overlay surface (manifest.json → overlays).
 *
 * The host mounts this element ONCE, permanently, on top of every page, inside
 * a full-screen layer with `pointer-events: none`; descendants of our element
 * get `pointer-events: auto`. Consequences:
 * - while there is nothing to show we must render NOTHING — any box we leave
 *   in the DOM would swallow clicks meant for the UI underneath;
 * - visibility is entirely ours: we open when the guard parks a print start
 *   (pendingChecks) or the widget asks for the spool picker (pickerRequest).
 *
 * `pendingChecks` / `pickerRequest` are signals: reading `.value` during render
 * subscribes this component, so it re-renders when the guard adds a check.
 */
export function Overlay({ api }: SurfaceProps) {
  const t = useT(api);
  const check = pendingChecks.value[0];
  const picker = pickerRequest.value;

  if (check) {
    return <CheckDialog key={check.token} api={api} check={check} queued={pendingChecks.value.length - 1} />;
  }
  if (picker) {
    const state = printerStates.value[picker.printerId] ?? emptyPrinterState();
    const close = () => (pickerRequest.value = null);
    return (
      <div class="spm-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
        <div class="spm-dialog" role="dialog" aria-modal="true">
          <div class="spm-dialog-header">
            <h3>{t('spoolman.picker.title', { tool: picker.tool })}</h3>
          </div>
          <div class="spm-dialog-body">
            <SpoolPicker
              api={api}
              printerId={picker.printerId}
              tool={picker.tool}
              currentId={spoolIdForTool(state, picker.tool)}
              onDone={close}
            />
          </div>
          <div class="spm-dialog-footer">
            <button type="button" class="spm-btn" onClick={close}>{t('spoolman.common.close')}</button>
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function CheckDialog({ api, check, queued }: { api: PluginApi; check: PendingCheck; queued: number }) {
  const t = useT(api);
  const [pickerTool, setPickerTool] = useState<string | null>(null);
  const state = printerStates.value[check.printerId] ?? emptyPrinterState();
  const printerName = api.printers.find((p) => p.id === check.printerId)?.name ?? check.printerId;

  const tools = (check.file?.tools ?? [0]).map((i) => `T${i}`);
  const general = check.issues.filter((i) => i.kind === 'unavailable');
  const hasIssues = check.issues.length > 0;

  return (
    <div class="spm-backdrop">
      <div class="spm-dialog" role="dialog" aria-modal="true" aria-labelledby="spm-check-title">
        <div class="spm-dialog-header">
          <h3 id="spm-check-title">{t('spoolman.check.title')}</h3>
          <div class="spm-muted">{t('spoolman.check.file', { name: check.filename })}</div>
          {api.printers.length > 1 && <div class="spm-muted">{t('spoolman.check.printer', { name: printerName })}</div>}
        </div>

        <div class="spm-dialog-body">
          {general.map((issue, i) => <p key={i} class="spm-error">{issueText(t, issue)}</p>)}

          {tools.map((tool) => (
            <CheckTool
              key={tool}
              api={api}
              check={check}
              tool={tool}
              showLabel={tools.length > 1 || state.tools.length > 1}
              issues={check.issues.filter((i): i is Exclude<Issue, { kind: 'unavailable' }> => i.kind !== 'unavailable' && i.tool === tool)}
              pickerOpen={pickerTool === tool}
              onTogglePicker={() => setPickerTool(pickerTool === tool ? null : tool)}
              onPicked={() => {
                setPickerTool(null);
                void recheck(check.token);
              }}
            />
          ))}

          {check.checking && <p class="spm-muted">{t('spoolman.check.checking')}</p>}
          {!check.checking && !hasIssues && <p class="spm-ok">{t('spoolman.check.ok')}</p>}
          {queued > 0 && <p class="spm-muted">{t('spoolman.check.queued', { count: queued })}</p>}
        </div>

        <div class="spm-dialog-footer">
          {/* deny → the request() that started the print rejects with GuardError */}
          <button type="button" class="spm-btn" onClick={() => resolveCheck(check.token, 'deny')}>
            {t('spoolman.check.cancel')}
          </button>
          {/* accept → the parked request continues to the next guard / Moonraker */}
          <button
            type="button"
            class={hasIssues ? 'spm-btn spm-btn-danger' : 'spm-btn spm-btn-primary'}
            disabled={check.checking}
            onClick={() => resolveCheck(check.token, 'accept')}
          >
            {hasIssues ? t('spoolman.check.printAnyway') : t('spoolman.check.print')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface CheckToolProps {
  api: PluginApi;
  check: PendingCheck;
  tool: string;
  showLabel: boolean;
  issues: Issue[];
  pickerOpen: boolean;
  onTogglePicker(): void;
  onPicked(): void;
}

function CheckTool({ api, check, tool, showLabel, issues, pickerOpen, onTogglePicker, onPicked }: CheckToolProps) {
  const t = useT(api);
  const state = printerStates.value[check.printerId] ?? emptyPrinterState();
  const spoolId = spoolIdForTool(state, tool);
  const spool = useSpool(check.printerId, spoolId);
  const expected = check.file ? materialFor(check.file, Number(tool.slice(1))) : '';

  return (
    <div class={issues.length > 0 ? 'spm-check-tool has-issue' : 'spm-check-tool'}>
      <div class="spm-tool" style={{ border: 'none', padding: 0 }}>
        {showLabel && <span class="spm-tool-label">{tool}</span>}
        <SpoolLine t={t} spool={spool} />
        <button type="button" class="spm-btn" onClick={onTogglePicker}>{t('spoolman.widget.change')}</button>
      </div>
      {issues.map((issue, i) => <span key={i} class="spm-warn">{issueText(t, issue)}</span>)}
      {pickerOpen && (
        <SpoolPicker
          api={api}
          printerId={check.printerId}
          tool={tool}
          currentId={spoolId}
          expectedMaterial={expected || undefined}
          onDone={onPicked}
        />
      )}
    </div>
  );
}
