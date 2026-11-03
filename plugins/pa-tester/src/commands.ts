/**
 * pa_tester G-code commands: one table drives the form, the preview and the
 * line that is sent.
 *
 * Source: `klippy/extras/pa_tester.py` (generic-cartesian branch of the
 * dmbutyugin/klipper fork). Every parameter is optional there and falls back
 * to the `[pa_tester]` section, so the plugin sends only the fields the user
 * filled in; placeholders show the values of the printer's own config.
 */

import type { PaMethod } from './parse';

export type CommandId = 'test' | 'calibrate';

export const METHODS: readonly PaMethod[] = ['step_response', 'search_overshoot'];

/** `PA_RANGE` upper limit of the module ("max exceeds search limit (2.00)"). */
export const PA_RANGE_LIMIT = 2.0;

export interface CommandDef {
  id: CommandId;
  gcode: 'TEST_PRESSURE_ADVANCE' | 'PA_CALIBRATE';
  /** Changes the printer state (SET_PRESSURE_ADVANCE): needs a confirmation. */
  applies: boolean;
}

export const COMMANDS: readonly CommandDef[] = [
  { id: 'test', gcode: 'TEST_PRESSURE_ADVANCE', applies: false },
  { id: 'calibrate', gcode: 'PA_CALIBRATE', applies: true },
];

export function commandDef(id: CommandId): CommandDef {
  return COMMANDS.find((c) => c.id === id) ?? COMMANDS[0]!;
}

export interface ParamDef {
  key: string;
  /**
   * `sensor` / `extruder` — choices come from the printer config at runtime
   * (`FORCE_SENSOR`, `EXTRUDER`); `range` — `PA_RANGE=min,max`.
   */
  type: 'number' | 'int' | 'sign' | 'sensor' | 'extruder' | 'range';
  /** Placeholder when the printer config has no value. */
  placeholder?: string;
  /** Exclusive lower bound (the module wants "above 0"). */
  above?: number;
  min?: number;
  max?: number;
  /** Only meaningful for this method (undefined — both). */
  method?: PaMethod;
}

export const PARAMS: readonly ParamDef[] = [
  { key: 'SLOW_FLOW', type: 'number', placeholder: '2', above: 0 },
  { key: 'HIGH_FLOW', type: 'number', above: 0 },
  { key: 'PURGE_LENGTH', type: 'number', above: 0 },
  { key: 'SEGMENT_TIME', type: 'number', placeholder: '0.5', above: 0 },
  { key: 'TEST_REPETITIONS', type: 'int', placeholder: '10', min: 1 },
  { key: 'FILTER_WINDOW', type: 'number', placeholder: '0.01', above: 0, max: 0.04 },
  { key: 'EXTRUDE_FORCE_SIGN', type: 'sign', placeholder: '0' },
  { key: 'PA_RANGE', type: 'range', placeholder: '0,0.2', method: 'search_overshoot' },
  { key: 'EXTRUDER', type: 'extruder' },
  { key: 'FORCE_SENSOR', type: 'sensor' },
];

/** Params that apply to `method`. */
export function paramsFor(method: PaMethod): readonly ParamDef[] {
  return PARAMS.filter((p) => !p.method || p.method === method);
}

export interface BuiltCommand {
  script: string;
  /** Keys of fields whose value is not valid; they are left out of `script`. */
  invalid: string[];
}

function finite(raw: string): number | null {
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) ? n : null;
}

function validNumber(p: ParamDef, raw: string): number | null {
  const n = finite(raw);
  if (n === null) return null;
  if (p.type === 'int' && !Number.isInteger(n)) return null;
  if (p.type === 'sign' && !(Number.isInteger(n) && n >= -1 && n <= 1)) return null;
  if (p.above !== undefined && !(n > p.above)) return null;
  if (p.min !== undefined && n < p.min) return null;
  if (p.max !== undefined && n > p.max) return null;
  return n;
}

/** `PA_RANGE=min,max` rules of the module: both non-negative, max < 2.0, min < max. */
export function parsePaRange(raw: string): [number, number] | null {
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length !== 2) return null;
  const min = finite(parts[0]!);
  const max = finite(parts[1]!);
  if (min === null || max === null) return null;
  if (min < 0 || max >= PA_RANGE_LIMIT || min >= max) return null;
  return [min, max];
}

/** An identifier of a config object: no whitespace, quotes or line breaks. */
const NAME = /^[^\s"'\r\n]+$/;

/**
 * The G-code line for `def` with `method` and the filled-in `values`. Invalid
 * fields are reported (and left out) instead of being sent: the module would
 * reject them only after it has started to move the toolhead.
 *
 * `METHOD` is always written: the preview and the console must show what
 * actually runs, not what the config default happens to be.
 */
export function buildCommand(
  def: CommandDef,
  method: PaMethod,
  values: Record<string, string>,
): BuiltCommand {
  const parts: string[] = [def.gcode, `METHOD=${method}`];
  const invalid: string[] = [];

  for (const p of paramsFor(method)) {
    const raw = (values[p.key] ?? '').trim();
    if (raw === '') continue;

    if (p.type === 'range') {
      const range = parsePaRange(raw);
      if (range) parts.push(`${p.key}=${range[0]},${range[1]}`);
      else invalid.push(p.key);
    } else if (p.type === 'sensor' || p.type === 'extruder') {
      if (NAME.test(raw)) parts.push(`${p.key}=${raw}`);
      else invalid.push(p.key);
    } else {
      const n = validNumber(p, raw);
      if (n === null) invalid.push(p.key);
      else parts.push(`${p.key}=${n}`);
    }
  }

  // Cross-field rule of the module: "high_flow must be greater than slow_flow".
  const slow = finite((values.SLOW_FLOW ?? '').trim());
  const high = finite((values.HIGH_FLOW ?? '').trim());
  if (slow !== null && high !== null && slow > 0 && high > 0 && high <= slow) {
    if (!invalid.includes('HIGH_FLOW')) invalid.push('HIGH_FLOW');
  }

  return { script: parts.join(' '), invalid };
}

/** Both names the guard has to recognise. */
export const PA_COMMAND_NAMES: ReadonlySet<string> = new Set(COMMANDS.map((c) => c.gcode));

/** First word of every G-code line of a script, upper-cased (comments skipped). */
export function scriptCommands(script: string): string[] {
  const out: string[] = [];
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    out.push(line.split(/\s+/)[0]!.toUpperCase());
  }
  return out;
}

/** `SET_PRESSURE_ADVANCE` for the extruder, or null when `pa` is not usable. */
export function setPaCommand(pa: number | null, extruder: string | null): string | null {
  if (pa === null || !Number.isFinite(pa) || pa < 0) return null;
  const value = Number(pa.toFixed(4));
  return extruder && extruder !== 'extruder'
    ? `SET_PRESSURE_ADVANCE ADVANCE=${value} EXTRUDER=${extruder}`
    : `SET_PRESSURE_ADVANCE ADVANCE=${value}`;
}
