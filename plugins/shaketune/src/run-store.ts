import { isRunStart, lastRunLines, parseStLog, emptyResult, type StResult } from './parse';
import type { PrinterConfig } from './printer-config';
import type { ResultFile } from './results';

/**
 * Per-printer state of the plugin, kept at MODULE level.
 *
 * WHY not inside the element: the host unmounts our tab whenever the user
 * switches to another calibration tab, another page, or back to Klipper's own
 * Input Shaper content (the point is `alternative`). A Shake&Tune run takes
 * minutes and keeps going in Klipper meanwhile; when the tab comes back it must
 * show the same log and results. Module state lives as long as the page.
 *
 * It holds only what Klipper/Moonraker cannot give back cheaply (the live log
 * of a run, which graphs are new). Everything else is re-read on mount.
 */

export interface PrinterRunState {
  /** Console lines of the current / last run (oldest first, bounded). */
  lines: string[];
  result: StResult;
  /** Our own `printer.gcode.script` request is in flight. */
  busy: boolean;
  /** A run started by someone else (console, macro, another client) is in progress. */
  external: boolean;
  /** Restored from server.gcode_store already (once per session and printer). */
  restored: boolean;

  config: PrinterConfig | null;
  configError: boolean;
  files: ResultFile[];
  filesLoaded: boolean;
  /** Graph files (path → modified) when our run started: what is NOT new. */
  baseline: Record<string, number> | null;
  /** Graphs written by the last run seen in this session. */
  fresh: string[];
}

const MAX_LINES = 300;

function initial(): PrinterRunState {
  return {
    lines: [],
    result: emptyResult(),
    busy: false,
    external: false,
    restored: false,
    config: null,
    configError: false,
    files: [],
    filesLoaded: false,
    baseline: null,
    fresh: [],
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

/** Mutate and notify. State objects are replaced, never mutated in place, so
 *  Lit's `hasChanged` (===) sees every change. */
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

/** Start of OUR run: fresh log, remember which graphs already exist. */
export function beginRun(printerId: string): void {
  const s = getState(printerId);
  update(printerId, {
    lines: [],
    result: { ...emptyResult(), running: true },
    busy: true,
    external: false,
    baseline: Object.fromEntries(s.files.map((f) => [f.path, f.modified])),
    fresh: [],
  });
}

export function endRun(printerId: string, errorLine?: string): void {
  const s = getState(printerId);
  const lines = errorLine ? [...s.lines, `!! ${errorLine}`].slice(-MAX_LINES) : s.lines;
  const result = parseStLog(lines);
  update(printerId, { busy: false, lines, result: { ...result, running: false } });
}

/**
 * Live console lines (`notify_gcode_response`).
 *
 * Collected only while a run is going on — otherwise every console line of the
 * printer would end up in our log. A Shake&Tune banner/command while we are not
 * running starts an EXTERNAL run (typed in the console, started by a macro or by
 * another client): Klipper prints `Shake&Tune version: …` at the start of every
 * command, which is how we notice runs we did not start.
 */
export function appendLines(printerId: string, incoming: string[]): void {
  const s = getState(printerId);
  let lines = s.lines;
  let external = s.external;
  let collecting = s.busy || s.result.running;
  let baseline = s.baseline;
  let fresh = s.fresh;

  for (const line of incoming) {
    if (!s.busy && isRunStart(line) && !collecting) {
      lines = [];
      external = true;
      collecting = true;
      baseline = Object.fromEntries(s.files.map((f) => [f.path, f.modified]));
      fresh = [];
    }
    if (!collecting) continue;
    lines = [...lines, line];
    // Stop collecting after the run's end marker (graphs created / error).
    if (!s.busy && !parseStLog(lines).running) collecting = false;
  }

  if (lines === s.lines) return;
  lines = lines.slice(-MAX_LINES);
  const result = parseStLog(lines);
  update(printerId, {
    lines,
    result: s.busy ? { ...result, running: true } : result,
    external: external && result.running,
    baseline,
    fresh,
  });
}

interface StoreEntry {
  message?: unknown;
  time?: unknown;
}

/** A "running" run in the history older than this is a leftover of a restart. */
const STALE_RUN_S = 30 * 60;

/**
 * Restores the last run from `server.gcode_store` (Moonraker's console
 * history, which also keeps the COMMANDS sent — notify_gcode_response does not)
 * when the tab mounts and we have no log for this printer yet: the user may
 * have started a test from the console, or reloaded the page mid-run.
 */
export function restoreFromHistory(printerId: string, entries: StoreEntry[], now = Date.now() / 1000): void {
  const s = getState(printerId);
  if (s.restored || s.busy || s.lines.length > 0) {
    update(printerId, { restored: true });
    return;
  }
  const messages = entries.flatMap((e) => (typeof e.message === 'string' ? e.message.split(/\r?\n/) : []));
  const lines = lastRunLines(messages.map((m) => m.trim()).filter(Boolean)).slice(-MAX_LINES);
  const result = parseStLog(lines);
  const lastTime = Number(entries[entries.length - 1]?.time ?? 0);
  const running = result.running && now - lastTime < STALE_RUN_S;
  update(printerId, {
    restored: true,
    lines,
    result: { ...result, running },
    external: running,
  });
}

/** New listing of graphs; marks the ones written since the run started. */
export function setFiles(printerId: string, files: ResultFile[]): void {
  const s = getState(printerId);
  const base = s.baseline;
  const fresh = base
    ? files.filter((f) => base[f.path] === undefined || f.modified > base[f.path]!).map((f) => f.path)
    : s.fresh;
  update(printerId, { files, filesLoaded: true, fresh });
}

/** Test helper: forget every printer. */
export function _resetAll(): void {
  states.clear();
  listeners.clear();
}
