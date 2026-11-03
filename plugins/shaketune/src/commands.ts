/**
 * Shake&Tune G-code commands: one table drives the form, the G-code preview
 * and the command that is sent.
 *
 * Source: klippain-shaketune `shaketune/commands/*.py` (v4 … v6). Every
 * parameter is OPTIONAL there and falls back to `[resonance_tester]` or to a
 * built-in default, so the plugin sends only the fields the user filled in.
 * That is also what keeps it compatible across versions: v4 has no
 * MAX_SCALE / ACCEL_CHIP, and an empty field is simply not sent.
 *
 * Placeholders show Shake&Tune's own defaults (`—` where the default comes from
 * the printer's [resonance_tester]).
 */

export type CommandId = 'shaper' | 'belts' | 'vibrations' | 'axesMap' | 'excitate';

/** Subfolders of `result_folder` (shaketune_config.py → RESULTS_SUBFOLDERS). */
export type ResultFolder = 'input_shaper' | 'belts' | 'vibrations' | 'axes_map' | 'static_freq';

export const RESULT_FOLDERS: readonly ResultFolder[] = [
  'input_shaper',
  'belts',
  'vibrations',
  'axes_map',
  'static_freq',
];

export interface ParamDef {
  /** G-code parameter name, also the field label (users see it in docs and logs). */
  key: string;
  /**
   * `chip` — an accelerometer config section of THIS printer (`adxl345`,
   * `adxl345 bed`, …): options come from the printer config at runtime.
   */
  type: 'number' | 'int' | 'select' | 'chip';
  /** Shake&Tune default shown as a placeholder; '' — taken from [resonance_tester]. */
  placeholder?: string;
  min?: number;
  max?: number;
  options?: readonly string[];
}

export interface CommandDef {
  id: CommandId;
  gcode: string;
  /** Where its graphs land (and what `<type> graphs created successfully!` says). */
  folder: ResultFolder;
  params: readonly ParamDef[];
  /** Kinematics the command supports (`printer.kinematics`); undefined — any. */
  kinematics?: readonly string[];
  /** Typical duration, shown next to Run. */
  minutes: string;
}

const FREQ_START: ParamDef = { key: 'FREQ_START', type: 'number', placeholder: '', min: 1 };
const FREQ_END: ParamDef = { key: 'FREQ_END', type: 'number', placeholder: '', min: 1 };
const HZ_PER_SEC: ParamDef = { key: 'HZ_PER_SEC', type: 'number', placeholder: '1', min: 1 };
const ACCEL_PER_HZ: ParamDef = { key: 'ACCEL_PER_HZ', type: 'number', placeholder: '' };
const TRAVEL_SPEED: ParamDef = { key: 'TRAVEL_SPEED', type: 'number', placeholder: '120', min: 20 };
const Z_HEIGHT: ParamDef = { key: 'Z_HEIGHT', type: 'number', placeholder: '', min: 1 };
const MAX_SCALE: ParamDef = { key: 'MAX_SCALE', type: 'int', placeholder: '', min: 1 };
const ACCEL_CHIP: ParamDef = { key: 'ACCEL_CHIP', type: 'chip' };

/** Config sections Shake&Tune accepts as ACCEL_CHIP (helpers/accelerometer.py). */
const CHIP_SECTION = /^(adxl345|lis2dw|lis3dh|mpu9250|icm20948|beacon)(\s|$)/i;

/** Accelerometer sections of a printer config (`configfile.settings` keys). */
export function accelChips(settingsKeys: readonly string[]): string[] {
  return settingsKeys.filter((k) => CHIP_SECTION.test(k));
}

export const COMMANDS: readonly CommandDef[] = [
  {
    id: 'shaper',
    gcode: 'AXES_SHAPER_CALIBRATION',
    folder: 'input_shaper',
    minutes: '2–5',
    params: [
      { key: 'AXIS', type: 'select', options: ['all', 'x', 'y'] },
      FREQ_START,
      FREQ_END,
      HZ_PER_SEC,
      ACCEL_PER_HZ,
      { key: 'SCV', type: 'number', placeholder: '', min: 0 },
      { key: 'MAX_SMOOTHING', type: 'number', placeholder: '', min: 0 },
      TRAVEL_SPEED,
      Z_HEIGHT,
      MAX_SCALE,
      ACCEL_CHIP,
    ],
  },
  {
    id: 'belts',
    gcode: 'COMPARE_BELTS_RESPONSES',
    folder: 'belts',
    minutes: '2–4',
    kinematics: ['corexy', 'corexz', 'limited_corexy', 'limited_corexz'],
    params: [FREQ_START, FREQ_END, HZ_PER_SEC, ACCEL_PER_HZ, TRAVEL_SPEED, Z_HEIGHT, MAX_SCALE, ACCEL_CHIP],
  },
  {
    id: 'vibrations',
    gcode: 'CREATE_VIBRATIONS_PROFILE',
    folder: 'vibrations',
    minutes: '10–30',
    kinematics: ['cartesian', 'corexy', 'corexz', 'limited_cartesian', 'limited_corexy', 'limited_corexz'],
    params: [
      { key: 'SIZE', type: 'number', placeholder: '100', min: 50 },
      { key: 'Z_HEIGHT', type: 'number', placeholder: '20', min: 1 },
      { key: 'MAX_SPEED', type: 'number', placeholder: '200', min: 10 },
      { key: 'SPEED_INCREMENT', type: 'number', placeholder: '2', min: 1 },
      { key: 'ACCEL', type: 'int', placeholder: '3000', min: 100 },
      TRAVEL_SPEED,
      ACCEL_CHIP,
    ],
  },
  {
    id: 'axesMap',
    gcode: 'AXES_MAP_CALIBRATION',
    folder: 'axes_map',
    minutes: '1',
    params: [
      { key: 'Z_HEIGHT', type: 'number', placeholder: '20', min: 1 },
      { key: 'SPEED', type: 'number', placeholder: '80', min: 20 },
      { key: 'ACCEL', type: 'int', placeholder: '1500', min: 100 },
      TRAVEL_SPEED,
    ],
  },
  {
    id: 'excitate',
    gcode: 'EXCITATE_AXIS_AT_FREQ',
    folder: 'static_freq',
    minutes: '1',
    params: [
      { key: 'AXIS', type: 'select', options: ['x', 'y', 'a', 'b'] },
      { key: 'FREQUENCY', type: 'number', placeholder: '25', min: 1 },
      { key: 'DURATION', type: 'int', placeholder: '30', min: 1 },
      { key: 'CREATE_GRAPH', type: 'select', options: ['0', '1'] },
      ACCEL_PER_HZ,
      TRAVEL_SPEED,
      Z_HEIGHT,
      ACCEL_CHIP,
    ],
  },
];

export function commandDef(id: CommandId): CommandDef {
  return COMMANDS.find((c) => c.id === id) ?? COMMANDS[0]!;
}

/**
 * Every name a Shake&Tune command may arrive under. With
 * `show_macros_in_webui: True` (the default) Shake&Tune registers the real
 * commands as `_AXES_SHAPER_CALIBRATION` … and adds `gcode_macro` wrappers under
 * the plain names; with False the plain names are the commands themselves.
 * The plugin always SENDS the plain name (works in both modes); the guard and
 * the log parser must RECOGNIZE both.
 */
export const ST_COMMAND_NAMES: ReadonlySet<string> = new Set(
  COMMANDS.flatMap((c) => [c.gcode, `_${c.gcode}`]),
);

export interface BuiltCommand {
  script: string;
  /** Keys of fields whose value is not a valid number for that parameter. */
  invalid: string[];
}

/**
 * The G-code line for `def` with the filled-in `values`. Invalid fields are
 * reported (and left out) instead of being sent: Klipper would reject the whole
 * command anyway, after the toolhead has already moved to the test point.
 */
export function buildCommand(def: CommandDef, values: Record<string, string>): BuiltCommand {
  const parts = [def.gcode];
  const invalid: string[] = [];

  for (const p of def.params) {
    const raw = (values[p.key] ?? '').trim();
    if (raw === '') continue;

    if (p.type === 'select') {
      if (p.options?.includes(raw)) parts.push(`${p.key}=${raw}`);
      else invalid.push(p.key);
      continue;
    }

    if (p.type === 'chip') {
      // "adxl345 bed" has a space: Klipper's extended G-code accepts a quoted value.
      if (/["\r\n]/.test(raw)) invalid.push(p.key);
      else parts.push(/\s/.test(raw) ? `${p.key}="${raw}"` : `${p.key}=${raw}`);
      continue;
    }

    const n = Number(raw);
    const ok =
      Number.isFinite(n) &&
      (p.type !== 'int' || Number.isInteger(n)) &&
      (p.min === undefined || n >= p.min) &&
      (p.max === undefined || n <= p.max);
    if (ok) parts.push(`${p.key}=${n}`);
    else invalid.push(p.key);
  }

  return { script: parts.join(' '), invalid };
}

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
