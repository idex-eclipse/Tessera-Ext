import { emptyResult, isRunStart, lastRunLines, parsePaLog, type PaResult } from './parse';
import type { PrinterConfig } from './printer-config';

/**
 * Per-printer state of the plugin, kept at MODULE level.
 *
 * WHY not inside the element: the host unmounts our tab whenever the user
 * switches to another calibration tab or page. A pa_tester run takes minutes
 * and keeps going in Klipper meanwhile; when the tab comes back it must show
 * the same log and result. Module state lives as long as the page.
 *
 * It holds only what Klipper/Moonraker cannot give back cheaply (the live log
 * of a run). Everything else is re-read on mount.
 */

export interface PrinterRunState {
  /** Console lines of the current / last run (oldest first, bounded). */
  lines: string[];
  result: PaResult;
  /** Our own `printer.gcode.script` request is in flight. */
  busy: boolean;
  /** A run started by someone else (console, macro, another client) is in progress. */
  external: boolean;
  /** Restored from server.gcode_store already (once per session and printer). */
  restored: boolean;
  /** Time of the last line of an external run, to drop a run that never ended. */
  lastLineAt: number;

  config: PrinterConfig | null;
  configError: boolean;
}

const MAX_LINES = 300;

/** An external "running" run without news for this long is a leftover. */
const STALE_RUN_S = 10 * 60;

function initial(): PrinterRunState {
  return {
    lines: [],
    result: emptyResult(),
    busy: false,
    external: false,
    restored: false,
    lastLineAt: 0,
    config: null,
    configError: false,
  };
}

const states = new Map<string, PrinterRunState>();
const listeners = new Map<string, Set<() => void>>();

export function getState(printerId: string): PrinterRunState {
  let s = states.get(printerId);
  if (!s) {
    s = initial();
    states.set(printerId, s);
  }
  return s;
}

/** Replace and notify. State objects are replaced, never mutated in place. */
export function update(printerId: string, patch: Partial<PrinterRunState>): void {
  states.set(printerId, { ...getState(printerId), ...patch });
  for (const cb of listeners.get(printerId) ?? []) cb();
}

export function subscribe(printerId: string, cb: () => void): () => void {
  let set = listeners.get(printerId);
  if (!set) {
    set = new Set();
    listeners.set(printerId, set);
  }
  set.add(cb);
  return () => set!.delete(cb);
}

/** Klipper restarted: a run in progress is gone; keep the log for reading. */
export function resetRun(printerId: string): void {
  const s = getState(printerId);
  update(printerId, {
    busy: false,
    external: false,
    result: { ...s.result, running: false },
    config: null,
  });
}

/** Start of OUR run: fresh log. */
export function beginRun(printerId: string): void {
  update(printerId, {
    lines: [],
    result: { ...emptyResult(), running: true },
    busy: true,
    external: false,
  });
}

export function endRun(printerId: string, errorLine?: string): void {
  const s = getState(printerId);
  const lines = errorLine ? [...s.lines, `!! ${errorLine}`].slice(-MAX_LINES) : s.lines;
  const result = parsePaLog(lines);
  update(printerId, { busy: false, lines, result: { ...result, running: false } });
}

/**
 * Live console lines (`notify_gcode_response`).
 *
 * Collected only while a run is going on, otherwise every console line of the
 * printer would end up in our log. A line only a fresh run prints first
 * (parse.ts `isRunStart`) while we are not running starts an EXTERNAL run
 * (typed in the console, a macro, another client).
 */
export function appendLines(printerId: string, incoming: string[], now = Date.now() / 1000): void {
  const s = getState(printerId);
  let lines = s.lines;
  let external = s.external;
  let collecting = s.busy || s.result.running;

  for (const line of incoming) {
    if (!s.busy && isRunStart(line) && !collecting) {
      lines = [];
      external = true;
      collecting = true;
    }
    if (!collecting) continue;
    lines = [...lines, line];
    // Stop collecting after the run's end marker (overall / Search complete / error).
    if (!s.busy && !parsePaLog(lines).running) collecting = false;
  }

  if (lines === s.lines) return;
  lines = lines.slice(-MAX_LINES);
  const result = parsePaLog(lines);
  update(printerId, {
    lines,
    result: s.busy ? { ...result, running: true } : result,
    external: external && result.running,
    lastLineAt: now,
  });
}

interface StoreEntry {
  message?: unknown;
  time?: unknown;
}

/**
 * Restores the last run from `server.gcode_store` (Moonraker's console
 * history, which also keeps the COMMANDS sent) when the tab mounts and we have
 * no log yet: the user may have started a test from the console, or reloaded
 * the page mid-run.
 */
export function restoreFromHistory(printerId: string, entries: StoreEntry[], now = Date.now() / 1000): void {
  const s = getState(printerId);
  if (s.restored || s.busy || s.lines.length > 0) {
    update(printerId, { restored: true });
    return;
  }
  const messages = entries.flatMap((e) => (typeof e.message === 'string' ? e.message.split(/\r?\n/) : []));
  const lines = lastRunLines(messages.map((m) => m.trim()).filter(Boolean)).slice(-MAX_LINES);
  const result = parsePaLog(lines);
  const lastTime = Number(entries[entries.length - 1]?.time ?? 0);
  const running = result.running && now - lastTime < STALE_RUN_S;
  update(printerId, {
    restored: true,
    lines,
    result: { ...result, running },
    external: running,
    lastLineAt: lastTime,
  });
}

/** Drops an external run that has been silent for too long (its closing line is not known for sure). */
export function expireStale(printerId: string, now = Date.now() / 1000): void {
  const s = getState(printerId);
  if (!s.external || s.busy || !s.result.running) return;
  if (now - s.lastLineAt < STALE_RUN_S) return;
  update(printerId, { external: false, result: { ...s.result, running: false } });
}

/** Test helper: forget every printer. */
export function _resetAll(): void {
  states.clear();
  listeners.clear();
}
