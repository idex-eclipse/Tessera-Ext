import { signal } from '@preact/signals';

import { apiRef } from './api-ref';
import { evaluate, parseMetadata, type FileFilament, type Issue } from './check';
import { getFileMetadata, saveToolSpool, setActiveSpoolId } from './moonraker';
import { spoolIdForTool } from './parse';
import type { GuardContext, GuardDecision, PluginApi } from './sdk';
import { invalidateSpools, loadSpool } from './spools';
import { ensureLoaded, getPrinterState, patchPrinterState } from './tracker';

/**
 * Guard `spoolman-print-start` (manifest.json → guards).
 *
 * The host GuardAgent calls the exported handler BEFORE any plugin's
 * `request('printer.print.start', …)` reaches Moonraker:
 *
 *   handler(request, token, ctx) → { action: 'allow' | 'deny' | 'freeze' }
 *
 * - `allow`  — no problems: the print starts without any dialog.
 * - `freeze` — the host PARKS the request. We store `token`, show our overlay,
 *              and later call `api.guards.resume(token, 'accept' | 'deny')`.
 *              The originating `request()` promise stays pending meanwhile
 *              (up to 10 minutes, then the host rejects it as guard_timeout).
 * - we never return `deny` directly: the plugin is advisory, the user decides.
 *
 * Host rules that shape this code (docs/en/guards.md):
 * - the decision must come within 10 s, otherwise the request is rejected
 *   (`guard_timeout`) — hence CHECK_TIMEOUT_MS below;
 * - a thrown error/rejected promise counts as `deny` (fail-closed) — so the
 *   handler catches everything itself and turns failures into a dialog;
 * - our own requests skip our guard (anti-recursion), so starting the print
 *   from our overlay would not re-trigger it — we do not need that anyway,
 *   resuming the parked request is the correct way to continue.
 */

/** Must stay well below the host's 10 s decision limit. */
const CHECK_TIMEOUT_MS = 6_000;

export interface PendingCheck {
  token: string;
  printerId: string;
  filename: string;
  file: FileFilament | null;
  issues: Issue[];
  /** Re-check after a spool change is running. */
  checking: boolean;
}

/** Parked print starts, oldest first. The overlay shows the first one. */
export const pendingChecks = signal<PendingCheck[]>([]);

/** Spool picker opened outside a print check (from the widget). */
export const pickerRequest = signal<{ printerId: string; tool: string } | null>(null);

interface GuardRequest {
  method: string;
  params: unknown;
  targetPrinterId: string;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

type CheckResult = { skip: true } | { skip: false; file: FileFilament | null; issues: Issue[] };

/** Loads metadata + spools of the target printer and evaluates them. */
async function runCheck(printerId: string, filename: string, fresh: boolean): Promise<CheckResult> {
  const api = apiRef.peek();
  if (!api) return { skip: true };

  const state = await ensureLoaded(printerId);
  // No [spoolman] in moonraker.conf → this printer does not use Spoolman.
  if (!state.hasSpoolman) return { skip: true };

  const h = api.moonrakerFor(printerId);
  let file: FileFilament | null = null;
  try {
    file = parseMetadata(await getFileMetadata(h, filename));
  } catch (e) {
    // No metadata (file not scanned yet, odd slicer): nothing to compare with,
    // but a missing spool is still worth a question.
    console.warn(`[spoolman] no metadata for ${filename}:`, e);
  }
  const used = file ?? parseMetadata(null);

  // Fetch every used tool's spool in parallel. `fresh` bypasses the cache:
  // remaining weight changes while printing, the guard must see current data.
  const spools = new Map<number, Awaited<ReturnType<typeof loadSpool>>>();
  await Promise.all(
    used.tools.map(async (index) => {
      const id = spoolIdForTool(state, `T${index}`);
      spools.set(index, id == null ? null : await loadSpool(printerId, id, fresh));
    }),
  );

  return { skip: false, file, issues: evaluate(used, (i) => spools.get(i) ?? null) };
}

function failure(e: unknown): CheckResult {
  const message = e instanceof Error ? e.message : String(e);
  return { skip: false, file: null, issues: [{ kind: 'unavailable', message }] };
}

/** Exported by name: manifest.json → guards[].handler = "guardPrintStart". */
export const guardPrintStart = async (
  request: GuardRequest,
  token: string,
  ctx: GuardContext,
): Promise<GuardDecision> => {
  if (request.method !== 'printer.print.start') return { action: 'allow' };

  // No api yet = no plugin surface has connected, so we could not show a
  // dialog anyway. Let the print go rather than park it invisibly.
  if (!apiRef.peek()) {
    console.warn('[spoolman] guard called before the plugin received its api — allowing');
    return { action: 'allow' };
  }

  const filename = (request.params as { filename?: unknown } | null)?.filename;
  if (typeof filename !== 'string' || !filename) return { action: 'allow' };

  // ctx.targetPrinterId — the printer the request goes to. In fleet mode this
  // is not necessarily the active printer, so never use api.printer here.
  const printerId = ctx.targetPrinterId;

  let result: CheckResult;
  try {
    result = await withTimeout(runCheck(printerId, filename, true), CHECK_TIMEOUT_MS);
  } catch (e) {
    result = failure(e);
  }
  if (result.skip || result.issues.length === 0) return { action: 'allow' };

  // Store the token BEFORE returning `freeze`: resume() needs it, and the
  // host hands it to us only here.
  pendingChecks.value = [
    ...pendingChecks.peek(),
    { token, printerId, filename, file: result.file, issues: result.issues, checking: false },
  ];
  return { action: 'freeze' };
};

function updatePending(token: string, p: Partial<PendingCheck>): void {
  pendingChecks.value = pendingChecks.peek().map((c) => (c.token === token ? { ...c, ...p } : c));
}

/** Re-evaluates a parked check (after the user changed a spool). */
export async function recheck(token: string): Promise<void> {
  const check = pendingChecks.peek().find((c) => c.token === token);
  if (!check) return;
  updatePending(token, { checking: true });
  let result: CheckResult;
  try {
    result = await withTimeout(runCheck(check.printerId, check.filename, true), CHECK_TIMEOUT_MS);
  } catch (e) {
    result = failure(e);
  }
  updatePending(token, result.skip
    ? { issues: [], checking: false }
    : { file: result.file, issues: result.issues, checking: false });
}

/**
 * Releases a parked print start.
 * 'accept' — the chain continues with the next guard, then Moonraker;
 * 'deny'   — the originating request() rejects with GuardError
 *            { code: 'denied_by_guard', pluginId: 'tessera/spoolman', reasonKey }.
 */
export function resolveCheck(token: string, decision: 'accept' | 'deny'): void {
  const api = apiRef.peek();
  pendingChecks.value = pendingChecks.peek().filter((c) => c.token !== token);
  // An unknown/expired token (10-minute park timeout) is ignored by the host
  // with a console warning — nothing else to handle here.
  api?.guards.resume(token, decision, decision === 'deny' ? 'spoolman.guard.cancelled' : undefined);
}

/**
 * Loads `spoolId` into `tool` of `printerId`.
 *
 * - With save_variables: persist `t<n>__spool_id` (the source of truth for
 *   per-tool spools, read by the tracker, the core tools widget and macros).
 * - Moonraker's active spool (the one it reports usage to) is switched too
 *   when this tool is the one printing now: single-tool printer, or the tool
 *   saved as `active_tool`. On multi-tool printers the tool-change macros keep
 *   it in sync afterwards (see README).
 */
export async function assignSpool(
  api: PluginApi,
  printerId: string,
  tool: string,
  spoolId: number | null,
): Promise<void> {
  const state = getPrinterState(printerId);
  const h = api.moonrakerFor(printerId);
  const multiTool = state.tools.length > 1;

  if (multiTool && !state.hasSaveVars) {
    throw new Error('save_variables');
  }
  if (state.hasSaveVars && state.tools.length > 0) {
    await saveToolSpool(h, tool, spoolId);
    patchPrinterState(printerId, { toolSpools: { ...getPrinterState(printerId).toolSpools, [tool]: spoolId } });
  }
  if (!multiTool || state.activeTool === tool) {
    await setActiveSpoolId(h, spoolId);
    patchPrinterState(printerId, { activeSpoolId: spoolId });
  }
  invalidateSpools(printerId);
}
