import { ST_COMMAND_NAMES, type CommandId } from './commands';

/**
 * Shake&Tune console output → structured result.
 *
 * Shake&Tune has NO status object (its class has no get_status(), so Klipper
 * does not list it in printer.objects). Everything it reports goes through
 * `gcode.respond_info`, i.e. the console: Moonraker pushes it as
 * `notify_gcode_response` and keeps the last lines in `server.gcode_store`.
 * The plugin therefore reads the same text a user reads in the console.
 *
 * Messages come from klippain-shaketune v4–v6 (`shaketune_process.py`,
 * `commands/*.py`, `graph_creators/computations/*_computation.py`). The parser
 * is a plain function of the lines, so live lines, the gcode_store history and
 * the tests all go through the same code.
 */

export type ShaperRecKind = 'performance' | 'lowVibrations' | 'best';

export interface ShaperRec {
  kind: ShaperRecKind;
  /** Klipper shaper type, lower-cased (`mzv`, `ei`, …) — what SET_INPUT_SHAPER expects. */
  name: string;
  freq: number;
  /** Damping ratio Shake&Tune estimated for this axis (null in older versions). */
  damping: number | null;
}

export interface ShaperAxisResult {
  recs: ShaperRec[];
  peaks: string | null;
  scv: number | null;
}

export interface StResult {
  /** `Shake&Tune version: v6.0.0` — printed at the start of every command. */
  version: string | null;
  kind: CommandId | null;
  /** A run has started and has not ended (last start marker after the last end marker). */
  running: boolean;
  /** At least one `… graphs created successfully!` in this run. */
  graphsCreated: boolean;
  error: string | null;
  /** Last informational line — shown as the progress text. */
  progress: string | null;
  shaper: Partial<Record<'X' | 'Y', ShaperAxisResult>>;
  belts: { similarity: number | null; health: string | null } | null;
  vibrations: {
    symmetry: number | null;
    peaks: string | null;
    speeds: string[];
    angles: string[];
    motor: string | null;
  } | null;
  axesMap: { detected: string | null; ok: boolean | null; suggestion: string | null } | null;
  excitate: { axis: string; freq: number; seconds: number } | null;
}

export function emptyResult(): StResult {
  return {
    version: null,
    kind: null,
    running: false,
    graphsCreated: false,
    error: null,
    progress: null,
    shaper: {},
    belts: null,
    vibrations: null,
    axesMap: null,
    excitate: null,
  };
}

/** `<type> graphs created successfully!` → command (shaketune_config.py graph types). */
const GRAPH_TYPES: Record<string, CommandId> = {
  'input shaper': 'shaper',
  'belts comparison': 'belts',
  'vibrations profile': 'vibrations',
  'axes map': 'axesMap',
  'static frequency': 'excitate',
};

const RE_VERSION = /^Shake&Tune version:\s*(\S+)/i;
const RE_GRAPHS_OK = /^(.+?) graphs created successfully!?/i;
const RE_TIMEOUT = /^Timeout:/i;
const RE_ERROR = /^Error[: ]/i;

const RE_AXIS = /^Measuring axis_([XY])\b|^([XY]) axis frequency profile generation/i;
const RE_REC = /(For performance|For low vibrations|Best shaper):\s*(\w+)\s*@\s*([\d.]+)\s*Hz(?:\s*\(with a damping ratio of ([\d.]+)\))?/i;
const RE_PEAKS = /^Peaks detected on the graph:\s*(.+)$/i;
const RE_SCV = /square corner velocity of ([\d.]+)/i;

const RE_BELTS_START = /^Measuring belt_|kinematics mode$|^Belts comparative/i;
const RE_SIMILARITY = /^Belts estimated similarity:\s*([\d.]+)\s*%/i;
const RE_HEALTH = /^Mechanical health:\s*(.+)$/i;

const RE_VIB_START = /^-> Measuring angle|^Current speed:|^Machine vibrations profile generation/i;
const RE_SYMMETRY = /vibration symmetry:\s*([\d.]+)\s*%/i;
const RE_VIB_PEAKS = /^Vibrations peaks detected:\s*(.+)$/i;
const RE_LOW_SPEEDS = /^Lowest vibrations speeds/i;
const RE_LOW_ANGLES = /^Lowest vibrations angles/i;
const RE_LIST_ITEM = /^\d+:\s*(.+)$/;
const RE_MOTOR = /^Motors have a main resonant frequency at (.+)$/i;

const RE_AXES_START = /^Analysis of the movements|^Machine axis /i;
const RE_AXES_DETECTED = /Detected axes_map:\s*(\S+)/i;
const RE_AXES_OK = /axes_map configuration is already correct/i;
const RE_AXES_SUGGEST = /update your configuration to\s*(\S+?)\.?$/i;

const RE_EXCITATE = /^Excitating (\w+) axis at ([\d.]+)\s*Hz for (\d+) seconds/i;

/**
 * Klipper prefixes respond_info lines with `// ` and errors with `!! `.
 * One Moonraker notification may carry several lines in one string.
 */
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

function stripPrefix(line: string): { text: string; error: boolean } {
  if (line.startsWith('!!')) return { text: line.replace(/^!!\s*/, ''), error: true };
  return { text: line.replace(/^\/\/\s*/, ''), error: false };
}

function shaperKind(label: string): ShaperRecKind {
  const l = label.toLowerCase();
  if (l.includes('performance')) return 'performance';
  if (l.includes('low')) return 'lowVibrations';
  return 'best';
}

/** True for a line that starts a Shake&Tune run (its version banner or a command echo). */
export function isRunStart(line: string): boolean {
  const { text } = stripPrefix(line);
  if (RE_VERSION.test(text)) return true;
  const word = text.split(/\s+/)[0]?.toUpperCase() ?? '';
  return ST_COMMAND_NAMES.has(word);
}

/**
 * Lines of the LAST Shake&Tune run in a console history (oldest first):
 * everything from the last command echo or version banner. Empty when the
 * history has no Shake&Tune run at all.
 */
export function lastRunLines(lines: readonly string[]): string[] {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!isRunStart(lines[i]!)) continue;
    // A command echo is followed by its own version banner: start at the echo.
    let start = i;
    if (i > 0 && RE_VERSION.test(stripPrefix(lines[i]!).text) && isRunStart(lines[i - 1]!)) start = i - 1;
    return lines.slice(start);
  }
  return [];
}

/** Parses the lines of ONE run (see lastRunLines). */
export function parseStLog(lines: readonly string[]): StResult {
  const r = emptyResult();
  let axis: 'X' | 'Y' | null = null;
  let list: 'speeds' | 'angles' | null = null;

  const start = (kind: CommandId | null) => {
    r.running = true;
    r.error = null;
    if (kind) r.kind = kind;
  };
  const vibrations = () =>
    (r.vibrations ??= { symmetry: null, peaks: null, speeds: [], angles: [], motor: null });
  const shaperAxis = (a: 'X' | 'Y') => (r.shaper[a] ??= { recs: [], peaks: null, scv: null });

  for (const raw of lines) {
    const { text, error } = stripPrefix(raw);
    if (!text) continue;

    // A command echo (gcode_store keeps the commands, notify_gcode_response does not).
    const word = text.split(/\s+/)[0]?.toUpperCase() ?? '';
    if (ST_COMMAND_NAMES.has(word)) {
      start(null);
      continue;
    }

    if (error) {
      r.error = text;
      r.running = false;
      continue;
    }

    let m: RegExpExecArray | null;

    if ((m = RE_VERSION.exec(text))) {
      r.version = m[1]!;
      start(null);
      continue;
    }
    if ((m = RE_GRAPHS_OK.exec(text))) {
      const kind = GRAPH_TYPES[m[1]!.toLowerCase()];
      if (kind) r.kind = kind;
      r.graphsCreated = true;
      // AXIS=all measures X, makes its graph, then measures Y: a later
      // "Measuring axis_Y" sets running again.
      r.running = false;
      continue;
    }
    if (RE_TIMEOUT.test(text) || RE_ERROR.test(text)) {
      r.error = text;
      r.running = false;
      continue;
    }

    // --- input shaper -----------------------------------------------------
    if ((m = RE_AXIS.exec(text))) {
      axis = (m[1] ?? m[2])!.toUpperCase() as 'X' | 'Y';
      shaperAxis(axis);
      start('shaper');
      r.progress = text;
      continue;
    }
    if ((m = RE_REC.exec(text))) {
      const target = shaperAxis(axis ?? 'X');
      target.recs.push({
        kind: shaperKind(m[1]!),
        name: m[2]!.toLowerCase(),
        freq: Number(m[3]),
        damping: m[4] !== undefined ? Number(m[4]) : null,
      });
      r.kind ??= 'shaper';
      continue;
    }
    if ((m = RE_PEAKS.exec(text))) {
      if (axis) shaperAxis(axis).peaks = m[1]!;
      continue;
    }
    if ((m = RE_SCV.exec(text))) {
      if (axis) shaperAxis(axis).scv = Number(m[1]);
      continue;
    }

    // --- belts --------------------------------------------------------------
    if (RE_BELTS_START.test(text)) {
      start('belts');
      r.belts ??= { similarity: null, health: null };
      r.progress = text;
      continue;
    }
    if ((m = RE_SIMILARITY.exec(text))) {
      (r.belts ??= { similarity: null, health: null }).similarity = Number(m[1]);
      r.kind ??= 'belts';
      continue;
    }
    if ((m = RE_HEALTH.exec(text))) {
      (r.belts ??= { similarity: null, health: null }).health = m[1]!;
      continue;
    }

    // --- vibrations -----------------------------------------------------------
    if (RE_VIB_START.test(text)) {
      start('vibrations');
      vibrations();
      r.progress = text;
      list = null;
      continue;
    }
    if ((m = RE_SYMMETRY.exec(text))) {
      vibrations().symmetry = Number(m[1]);
      r.kind ??= 'vibrations';
      continue;
    }
    if ((m = RE_VIB_PEAKS.exec(text))) {
      vibrations().peaks = m[1]!;
      continue;
    }
    if (RE_LOW_SPEEDS.test(text)) {
      list = 'speeds';
      continue;
    }
    if (RE_LOW_ANGLES.test(text)) {
      list = 'angles';
      continue;
    }
    if (list && (m = RE_LIST_ITEM.exec(text))) {
      vibrations()[list].push(m[1]!);
      continue;
    }
    if ((m = RE_MOTOR.exec(text))) {
      vibrations().motor = m[1]!;
      continue;
    }

    // --- axes map ---------------------------------------------------------------
    if (RE_AXES_START.test(text)) {
      start('axesMap');
      r.axesMap ??= { detected: null, ok: null, suggestion: null };
      r.progress = text;
      continue;
    }
    if ((m = RE_AXES_DETECTED.exec(text))) {
      (r.axesMap ??= { detected: null, ok: null, suggestion: null }).detected = m[1]!;
      r.kind ??= 'axesMap';
      continue;
    }
    if (RE_AXES_OK.test(text)) {
      (r.axesMap ??= { detected: null, ok: null, suggestion: null }).ok = true;
      continue;
    }
    if ((m = RE_AXES_SUGGEST.exec(text))) {
      const map = (r.axesMap ??= { detected: null, ok: null, suggestion: null });
      map.ok = false;
      map.suggestion = m[1]!;
      continue;
    }

    // --- excitate -----------------------------------------------------------------
    if ((m = RE_EXCITATE.exec(text))) {
      start('excitate');
      r.excitate = { axis: m[1]!.toLowerCase(), freq: Number(m[2]), seconds: Number(m[3]) };
      r.progress = text;
      continue;
    }

    // Anything else while running is progress chatter ("This may take some time…").
    if (r.running) r.progress = text;
  }

  return r;
}
