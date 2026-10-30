import { signal } from '@preact/signals';

import { getActiveSpoolId, getSpoolmanConnected } from './moonraker';
import { activeToolFromVariables, toolSpoolsFromVariables, toolsFromObjects } from './parse';
import type { PluginApi } from './sdk';
import { emptyPrinterState, type PrinterSpoolState } from './types';

/**
 * Spool state of EVERY printer in the host registry, kept live.
 *
 * WHY a module-level tracker and not state inside the widget:
 * the guard must decide for the printer the request targets
 * (`ctx.targetPrinterId`), which in fleet mode is often not the active printer
 * and may have no widget mounted at all. State tied to a component would be
 * missing or stale exactly when the guard needs it.
 *
 * Lifecycle: started once from index.ts as soon as the plugin has an api
 * (the always-mounted overlay provides it at app start); follows the printer
 * registry through `api.onPrintersChange`. Handles from `api.moonrakerFor`
 * are stable per printer and survive reconnects and URL changes, so
 * subscriptions are created once per printer.
 */

export const printerStates = signal<Record<string, PrinterSpoolState>>({});

interface Tracked {
  offs: Array<() => void>;
  offVars: (() => void) | null;
  loading: Promise<void> | null;
}

const tracked = new Map<string, Tracked>();
let trackerApi: PluginApi | null = null;
let offPrinters: (() => void) | null = null;

/**
 * Local update after our own write (SAVE_VARIABLE / post_spool_id). The
 * subscription/notification brings the same value a moment later; patching
 * now lets an immediate re-check see the new spool.
 */
export function patchPrinterState(printerId: string, p: Partial<PrinterSpoolState>): void {
  patch(printerId, p);
}

function patch(printerId: string, p: Partial<PrinterSpoolState>): void {
  const all = printerStates.peek();
  printerStates.value = { ...all, [printerId]: { ...(all[printerId] ?? emptyPrinterState()), ...p } };
}

export function getPrinterState(printerId: string): PrinterSpoolState {
  return printerStates.peek()[printerId] ?? emptyPrinterState();
}

/** (Re)reads everything that is not pushed by Moonraker notifications. */
function load(api: PluginApi, printerId: string): Promise<void> {
  const entry = tracked.get(printerId);
  if (!entry) return Promise.resolve();
  if (entry.loading) return entry.loading;

  const run = async () => {
    const h = api.moonrakerFor(printerId);
    try {
      // `components` lists Moonraker components that loaded successfully:
      // 'spoolman' is present only when moonraker.conf has a [spoolman] section.
      const info = await h.request<{ components?: string[] }>('server.info');
      const hasSpoolman = Array.isArray(info?.components) && info.components.includes('spoolman');

      // Fails while Klippy is not ready; we retry on notify_klippy_ready.
      const objects = await h
        .request<{ objects?: string[] }>('printer.objects.list')
        .then((r) => r?.objects ?? [])
        .catch(() => [] as string[]);

      const tools = toolsFromObjects(objects);
      const hasSaveVars = objects.includes('save_variables');
      patch(printerId, { hasSpoolman, tools, hasSaveVars });

      if (hasSpoolman) {
        const [activeSpoolId, connected] = await Promise.all([
          getActiveSpoolId(h).catch(() => null),
          getSpoolmanConnected(h).catch(() => false),
        ]);
        patch(printerId, { activeSpoolId, connected });
      }

      subscribeVariables(api, printerId, hasSaveVars);
    } catch (e) {
      console.warn(`[spoolman] cannot load state of printer ${printerId}:`, e);
    } finally {
      patch(printerId, { ready: true });
    }
  };

  entry.loading = run().finally(() => {
    entry.loading = null;
  });
  return entry.loading;
}

/**
 * Per-tool spool ids live in Klipper's save_variables. Subscribing (instead of
 * querying) means a SAVE_VARIABLE from a tool-change macro, the console or
 * another client updates the widget and the guard immediately.
 */
function subscribeVariables(api: PluginApi, printerId: string, enabled: boolean): void {
  const entry = tracked.get(printerId);
  if (!entry) return;
  entry.offVars?.();
  entry.offVars = null;
  if (!enabled) return;

  entry.offVars = api.moonrakerFor(printerId).subscribe(
    { save_variables: ['variables'] },
    (delta) => {
      const vars = delta?.save_variables?.variables;
      if (!vars || typeof vars !== 'object') return;
      const tools = getPrinterState(printerId).tools;
      patch(printerId, {
        toolSpools: toolSpoolsFromVariables(vars, tools),
        activeTool: activeToolFromVariables(vars),
      });
    },
    // immediate: get the current snapshot from the host cache right away,
    // not only the next change.
    { immediate: true },
  );
}

function track(api: PluginApi, printerId: string): void {
  if (tracked.has(printerId)) return;
  const entry: Tracked = { offs: [], offVars: null, loading: null };
  tracked.set(printerId, entry);
  patch(printerId, {});

  const h = api.moonrakerFor(printerId);

  // Moonraker pushes these; params arrive as Moonraker sends them (an array).
  entry.offs.push(
    h.onNotify('notify_active_spool_set', (params) => {
      const p = Array.isArray(params) ? params[0] : params;
      const id = Number(p?.spool_id);
      patch(printerId, { activeSpoolId: Number.isFinite(id) && id > 0 ? id : null });
    }),
    h.onNotify('notify_spoolman_status_changed', (params) => {
      const p = Array.isArray(params) ? params[0] : params;
      patch(printerId, { connected: p?.spoolman_connected === true });
    }),
    // Klipper restart may change macros / save_variables availability.
    h.onNotify('notify_klippy_ready', () => void load(api, printerId)),
    // Fires on every (re)connect to Moonraker.
    h.onReady(() => void load(api, printerId)),
  );

  if (h.readyState === 'open') void load(api, printerId);
}

function untrack(printerId: string): void {
  const entry = tracked.get(printerId);
  if (!entry) return;
  for (const off of entry.offs) off();
  entry.offVars?.();
  tracked.delete(printerId);
  const { [printerId]: _removed, ...rest } = printerStates.peek();
  printerStates.value = rest;
}

function sync(api: PluginApi, ids: readonly string[]): void {
  const alive = new Set(ids);
  for (const id of Array.from(tracked.keys())) if (!alive.has(id)) untrack(id);
  for (const id of alive) track(api, id);
}

/** Idempotent; called once the plugin receives its api. */
export function startTracker(api: PluginApi): void {
  trackerApi = api;
  if (offPrinters) return;
  sync(api, api.printers.map((p) => p.id));
  offPrinters = api.onPrintersChange((printers) => {
    if (trackerApi) sync(trackerApi, printers.map((p) => p.id));
  });
}

/**
 * State of `printerId`, waiting for the first load if needed (guard path).
 * Never rejects: on failure the state just says "no spoolman".
 */
export async function ensureLoaded(printerId: string): Promise<PrinterSpoolState> {
  const api = trackerApi;
  if (!api) return getPrinterState(printerId);
  if (!tracked.has(printerId)) track(api, printerId);
  if (!getPrinterState(printerId).ready) await load(api, printerId);
  return getPrinterState(printerId);
}

/** Manual refresh (widget header button). */
export function reloadPrinter(printerId: string): Promise<void> {
  return trackerApi ? load(trackerApi, printerId) : Promise.resolve();
}
