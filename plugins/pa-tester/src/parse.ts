/**
 * Parser of the pa_tester console output.
 *
 * Source: `klippy/extras/pa_tester.py` of the generic-cartesian branch of the
 * dmbutyugin/klipper fork. The module writes everything through
 * `gcmd.respond_info`, so Moonraker delivers it as plain `// …` console lines
 * (`notify_gcode_response`) and keeps it in `server.gcode_store`. It publishes
 * no result file; the status object only holds the LAST result.
 *
 * Messages (exact text of the module):
 *   Detected extrude_force_sign=%d
 *   WARNING: high_flow is less than 2x slow_flow, …
 *   Wait for calculations..                                 (every 5 s, may be absent from the log)
 *   step_response:    PA calibration results:
 *                       flow=%5.2f  pressure_advance=%.3f   (one per flow)
 *                       overall pressure_advance=%.3f
 *                     Failed to detect Pressure Advance value. / Check sensor and filament …
 *   search_overshoot: Searching for optimal pressure_advance...
 *                     Test %d: pressure_advance=%.4f ...
 *                     Tested pressure_advance=%.4f -> overshoot | no overshoot
 *                     Search complete: %d tests, pressure_advance=%.4f
 *                     PA correction: pressure_advance=%.4f  (+ "(accounts for force data filtering)")
 *   WARNING: …                                              (several, see below)
 *
 * The end of a run is NOT read from the log: the plugin's own run ends when
 * `printer.gcode.script` returns. For runs started elsewhere the markers
 * `overall` / `Search complete` / `Failed to detect` / `!!` end it; the exact
 * closing line of step_response after `overall` is not known, so a leftover
 * "running" state is dropped by age (run-store.ts).
 */

export type PaMethod = 'step_response' | 'search_overshoot';

export interface FlowPa {
  flow: number;
  pa: number;
}

export interface SearchStep {
  pa: number;
  overshoot: boolean;
}

export interface PaResult {
  running: boolean;
  method: PaMethod | null;
  /** step_response: PA for every tested flow. */
  perFlow: FlowPa[];
  /** step_response: `overall pressure_advance`. */
  overall: number | null;
  /** search_overshoot: the tested values in order. */
  search: SearchStep[];
  /** search_overshoot: `Search complete … pressure_advance`. */
  found: number | null;
  /** search_overshoot: `PA correction` (force-filter corrected value). */
  corrected: number | null;
  forceSign: number | null;
  warnings: string[];
  /** Failure text (a `!!` line, a module error or "Failed to detect"). */
  error: string | null;
  /** The value `PA_CALIBRATE` applies / the one worth applying. */
  value: number | null;
}

export function emptyResult(): PaResult {
  return {
    running: false,
    method: null,
    perFlow: [],
    overall: null,
    search: [],
    found: null,
    corrected: null,
    forceSign: null,
    warnings: [],
    error: null,
    value: null,
  };
}

const RE_COMMAND = /^(TEST_PRESSURE_ADVANCE|PA_CALIBRATE)\b/i;
const RE_SIGN = /^Detected extrude_force_sign=(-?\d+)/;
const RE_HIGH_FLOW = /^WARNING: high_flow is less than 2x slow_flow/;
const RE_SEARCHING = /^Searching for optimal pressure_advance/;
const RE_RESULTS = /^PA calibration results:/;
const RE_FLOW = /^flow=\s*(-?\d+(?:\.\d+)?)\s+pressure_advance=(-?\d+(?:\.\d+)?)/;
const RE_OVERALL = /^overall pressure_advance=(-?\d+(?:\.\d+)?)/;
const RE_FAILED = /^Failed to detect Pressure Advance value/;
const RE_TESTED = /^Tested pressure_advance=(-?\d+(?:\.\d+)?)\s*->\s*(no overshoot|overshoot)/;
const RE_COMPLETE = /^Search complete:\s*(\d+) tests?, pressure_advance=(-?\d+(?:\.\d+)?)/;
const RE_CORRECTION = /^PA correction: pressure_advance=(-?\d+(?:\.\d+)?)/;
const RE_WARNING = /^WARNING:\s*(.+)$/;
const RE_TEST_N = /^Test (\d+): pressure_advance=(-?\d+(?:\.\d+)?)/;
const RE_NOISE = /^(Wait for calculations\.\.|\(accounts for force data filtering\)|Check sensor and filament)/;

/** Splits a `notify_gcode_response` payload / a gcode_store message into trimmed non-empty lines. */
export function normalizeLines(raw: unknown): string[] {
  const items = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== 'string') continue;
    for (const line of item.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

function strip(line: string): { text: string; error: boolean } {
  if (line.startsWith('!!')) return { text: line.replace(/^!!\s*/, ''), error: true };
  return { text: line.replace(/^\/\/\s*/, ''), error: false };
}

/** Is this the echo of our command or a line only a fresh run prints first? */
export function isRunStart(line: string): boolean {
  const { text } = strip(line);
  return (
    RE_COMMAND.test(text) ||
    RE_SIGN.test(text) ||
    RE_HIGH_FLOW.test(text) ||
    RE_SEARCHING.test(text)
  );
}

/** Echo of a pa_tester command (not a log line of the module). */
function isCommandEcho(line: string): boolean {
  return RE_COMMAND.test(strip(line).text);
}

/**
 * The lines of the LAST run of a console history: from the last command echo
 * (fallback: the last line a run prints first). Empty when there is none.
 */
export function lastRunLines(lines: readonly string[]): string[] {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isCommandEcho(lines[i]!)) return lines.slice(i);
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isRunStart(lines[i]!)) return lines.slice(i);
  }
  return [];
}

/** Method of a command echo: `METHOD=` wins, otherwise unknown (config default). */
function methodOf(text: string): PaMethod | null {
  const m = /\bMETHOD=(step_response|search_overshoot)\b/i.exec(text);
  return m ? (m[1]!.toLowerCase() as PaMethod) : null;
}

/** Parses the lines of ONE run (see lastRunLines). */
export function parsePaLog(lines: readonly string[]): PaResult {
  const r = emptyResult();

  for (const raw of lines) {
    const { text, error } = strip(raw);

    if (error) {
      r.error = text;
      r.running = false;
      continue;
    }

    if (RE_COMMAND.test(text)) {
      r.running = true;
      r.error = null;
      const m = methodOf(text);
      if (m) r.method = m;
      continue;
    }

    let m: RegExpExecArray | null;
    if ((m = RE_SIGN.exec(text))) {
      r.running = true;
      r.forceSign = Number(m[1]);
    } else if (RE_HIGH_FLOW.test(text)) {
      r.running = true;
      r.warnings.push(text.replace(/^WARNING:\s*/, ''));
    } else if (RE_SEARCHING.test(text)) {
      r.running = true;
      r.method = 'search_overshoot';
    } else if ((m = RE_TEST_N.exec(text))) {
      r.running = true;
      r.method = 'search_overshoot';
    } else if ((m = RE_TESTED.exec(text))) {
      r.method = 'search_overshoot';
      r.search.push({ pa: Number(m[1]), overshoot: m[2] === 'overshoot' });
    } else if ((m = RE_COMPLETE.exec(text))) {
      r.method = 'search_overshoot';
      r.found = Number(m[2]);
      r.value = r.found;
      r.running = false;
    } else if ((m = RE_CORRECTION.exec(text))) {
      r.corrected = Number(m[1]);
      r.value = r.corrected;
    } else if (RE_RESULTS.test(text)) {
      r.method = 'step_response';
      r.running = true;
    } else if ((m = RE_FLOW.exec(text))) {
      r.method = 'step_response';
      r.perFlow.push({ flow: Number(m[1]), pa: Number(m[2]) });
    } else if ((m = RE_OVERALL.exec(text))) {
      r.method = 'step_response';
      r.overall = Number(m[1]);
      r.value = r.overall;
      r.running = false;
    } else if (RE_FAILED.test(text)) {
      r.error = text;
      r.running = false;
    } else if (RE_WARNING.test(text)) {
      r.warnings.push(RE_WARNING.exec(text)![1]!);
    } else if (RE_NOISE.test(text)) {
      continue;
    }
  }

  // search_overshoot: a correction replaces `found`, but `found` stays visible.
  if (r.corrected === null && r.found !== null) r.value = r.found;
  return r;
}
