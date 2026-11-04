/**
 * The catalog of datasets a user can build, replacing motan's text syntax.
 *
 * motan asks for `deviation(stepq(stepper_x),kin(stepper_x))?color=blue`. Here every
 * dataset type is described by data: which parameters it takes, what each may be, and
 * whether this capture can provide it at all. The UI renders forms from it, and the
 * result is a `Node` tree that `nodeToName` turns into the motan name the engine uses as
 * the dataset's identity (so saved graphs stay readable by real motan too).
 *
 * `parseName` is the inverse: it turns a motan name back into a Node, for presets, saved
 * graphs and for anyone pasting a motan expression.
 */
import { nameSplit } from './names';
import { MotanError, type CaptureData } from './types';

/** What the pickers need to know about a capture. */
export interface CaptureInfo {
  /** Subscription ids, e.g. `accelerometer:hotend`. */
  subscriptions: readonly string[];
  /** `configfile.settings` of the initial status. */
  config: Record<string, Record<string, unknown>>;
  /** `printer.kinematics`, if the config has it. */
  kinematics: string | undefined;
  /** Numeric status fields (`extruder.temperature`) usable by `status(...)`. */
  statusFields: readonly string[];
}

export function captureInfo(capture: CaptureData): CaptureInfo {
  const config = (capture.initialStatus.configfile?.settings ?? {}) as Record<string, Record<string, unknown>>;
  const fields: string[] = [];
  for (const [obj, values] of Object.entries(capture.initialStatus)) {
    if (obj === 'configfile') continue;
    for (const [key, v] of Object.entries(values)) {
      if (typeof v === 'number' || typeof v === 'boolean') fields.push(`${obj}.${key}`);
    }
  }
  const kin = config.printer?.kinematics;
  return {
    subscriptions: [...capture.subscriptions],
    config,
    kinematics: typeof kin === 'string' ? kin : undefined,
    statusFields: fields,
  };
}

/** Names of the subscriptions of one kind: `names(info, 'trapq')` -> `['toolhead']`. */
function names(info: CaptureInfo, kind: string): string[] {
  const prefix = `${kind}:`;
  return info.subscriptions.filter((s) => s.startsWith(prefix)).map((s) => s.slice(prefix.length));
}

export interface Choice {
  value: string;
  /** True when `value` is a name from the printer (shown as is) rather than a translated term. */
  literal?: boolean;
}

export type ParamKind = 'dataset' | 'choice' | 'number' | 'text';

export interface ParamDef {
  key: string;
  kind: ParamKind;
  /** i18n key of the field label. */
  labelKey: string;
  choices?: Choice[];
  /** An optional parameter may be left empty; only trailing ones can be dropped from a name. */
  optional?: boolean;
  /** Initial value of a required parameter; for an optional one, the value motan assumes when it is left empty. */
  default?: string;
  min?: number;
  step?: number;
  /** Suggestions for a free text field. */
  suggest?: readonly string[];
}

/** A dataset in the making: a function and its arguments (nested nodes for dataset parameters). */
export interface Node {
  fn: string;
  args: Record<string, Node | string>;
}

export interface FuncDef {
  fn: string;
  group: 'raw' | 'derived';
  /** i18n keys of the name and of the one-line description. */
  labelKey: string;
  descKey: string;
  /** Can this capture provide it? (A raw type needs its stream; `kin` needs supported kinematics.) */
  available(info: CaptureInfo): boolean;
  /** Parameters in motan's positional order; may depend on the values entered so far. */
  params(args: Record<string, Node | string>, info: CaptureInfo): ParamDef[];
}

const lit = (values: string[]): Choice[] => values.map((value) => ({ value, literal: true }));
const terms = (values: string[]): Choice[] => values.map((value) => ({ value }));

const AXES = ['x', 'y', 'z'];
const TRAPQ_SELECTIONS = [
  'velocity',
  'accel',
  ...AXES,
  ...AXES.map((a) => `${a}_velocity`),
  ...AXES.map((a) => `${a}_accel`),
];

function source(info: CaptureInfo, kind: string, labelKey = 'motiondiag.param.source'): ParamDef {
  const choices = lit(names(info, kind));
  return { key: 'source', kind: 'choice', labelKey, choices, default: choices[0]?.value };
}

const hasKind = (kind: string) => (info: CaptureInfo) => names(info, kind).length > 0;

/** Stepper drivers (`tmc2209 stepper_x`) whose step queue was captured, for `step_phase`. */
function phaseDrivers(info: CaptureInfo): string[] {
  const out: string[] = [];
  for (const key of Object.keys(info.config)) {
    if (!key.startsWith('tmc')) continue;
    const stepper = key.split(/\s+/).filter(Boolean).slice(1).join(' ');
    if (stepper && typeof info.config[stepper]?.microsteps === 'number' && info.subscriptions.includes(`stepq:${stepper}`)) {
      out.push(key);
    }
  }
  return out;
}

const dataset = (key: string, labelKey: string, optional = false): ParamDef => ({ key, kind: 'dataset', labelKey, optional });

/** Settings of the `sos(...)` filter depend on the filter type. */
function sosParams(args: Record<string, Node | string>): ParamDef[] {
  const num = (key: string, labelKey: string, def: string, min = 0): ParamDef => ({
    key,
    kind: 'number',
    labelKey,
    default: def,
    min,
    step: 1,
  });
  const type = typeof args.type === 'string' ? args.type : 'lowpass';
  const head: ParamDef[] = [
    dataset('source', 'motiondiag.param.input'),
    { key: 'mode', kind: 'choice', labelKey: 'motiondiag.param.sosMode', choices: terms(['filt', 'filtfilt']), default: 'filtfilt' },
    {
      key: 'type',
      kind: 'choice',
      labelKey: 'motiondiag.param.sosType',
      choices: terms(['lowpass', 'highpass', 'bandpass', 'notch']),
      default: 'lowpass',
    },
  ];
  if (type === 'notch') {
    return [...head, num('a', 'motiondiag.param.notchHz', '50', 1), num('b', 'motiondiag.param.quality', '10', 0.1)];
  }
  if (type === 'bandpass') {
    return [
      ...head,
      num('a', 'motiondiag.param.order', '2', 1),
      num('b', 'motiondiag.param.lowHz', '20', 0.1),
      num('c', 'motiondiag.param.highHz', '100', 0.1),
    ];
  }
  return [...head, num('a', 'motiondiag.param.order', '2', 1), num('b', 'motiondiag.param.cutoffHz', '50', 0.1)];
}

export const FUNCS: readonly FuncDef[] = [
  // ---- raw datasets (readlog.py) ----
  {
    fn: 'trapq',
    group: 'raw',
    labelKey: 'motiondiag.fn.trapq',
    descKey: 'motiondiag.fnDesc.trapq',
    available: hasKind('trapq'),
    params: (_a, info) => [
      source(info, 'trapq'),
      { key: 'what', kind: 'choice', labelKey: 'motiondiag.param.quantity', choices: terms(TRAPQ_SELECTIONS), default: 'velocity' },
    ],
  },
  {
    fn: 'stepq',
    group: 'raw',
    labelKey: 'motiondiag.fn.stepq',
    descKey: 'motiondiag.fnDesc.stepq',
    available: hasKind('stepq'),
    params: (_a, info) => [
      source(info, 'stepq', 'motiondiag.param.stepper'),
      { key: 'smooth', kind: 'number', labelKey: 'motiondiag.param.smoothSec', optional: true, default: '0.01', min: 0.0001, step: 0.001 },
    ],
  },
  {
    fn: 'step_phase',
    group: 'raw',
    labelKey: 'motiondiag.fn.step_phase',
    descKey: 'motiondiag.fnDesc.step_phase',
    available: (info) => phaseDrivers(info).length > 0,
    params: (_a, info) => {
      const drivers = lit(phaseDrivers(info));
      return [
        { key: 'driver', kind: 'choice', labelKey: 'motiondiag.param.driver', choices: drivers, default: drivers[0]?.value },
        { key: 'mode', kind: 'choice', labelKey: 'motiondiag.param.quantity', optional: true, choices: terms(['microstep']), default: '' },
      ];
    },
  },
  {
    fn: 'accelerometer',
    group: 'raw',
    labelKey: 'motiondiag.fn.accelerometer',
    descKey: 'motiondiag.fnDesc.accelerometer',
    available: hasKind('accelerometer'),
    params: (_a, info) => [
      source(info, 'accelerometer', 'motiondiag.param.sensor'),
      { key: 'axis', kind: 'choice', labelKey: 'motiondiag.param.axis', choices: terms(AXES), default: 'x' },
    ],
  },
  {
    fn: 'angle',
    group: 'raw',
    labelKey: 'motiondiag.fn.angle',
    descKey: 'motiondiag.fnDesc.angle',
    available: hasKind('angle'),
    params: (_a, info) => [source(info, 'angle', 'motiondiag.param.sensor')],
  },
  {
    fn: 'ldc1612',
    group: 'raw',
    labelKey: 'motiondiag.fn.ldc1612',
    descKey: 'motiondiag.fnDesc.ldc1612',
    available: hasKind('ldc1612'),
    params: (_a, info) => [
      source(info, 'ldc1612', 'motiondiag.param.sensor'),
      { key: 'what', kind: 'choice', labelKey: 'motiondiag.param.quantity', optional: true, choices: terms(['period', 'z']), default: '' },
    ],
  },
  {
    fn: 'loadcell',
    group: 'raw',
    labelKey: 'motiondiag.fn.loadcell',
    descKey: 'motiondiag.fnDesc.loadcell',
    available: hasKind('loadcell'),
    params: (_a, info) => [
      source(info, 'loadcell', 'motiondiag.param.sensor'),
      { key: 'what', kind: 'choice', labelKey: 'motiondiag.param.quantity', optional: true, choices: terms(['counts']), default: '' },
    ],
  },
  {
    fn: 'stallguard',
    group: 'raw',
    labelKey: 'motiondiag.fn.stallguard',
    descKey: 'motiondiag.fnDesc.stallguard',
    available: hasKind('stallguard'),
    params: (_a, info) => [
      source(info, 'stallguard', 'motiondiag.param.stepper'),
      { key: 'what', kind: 'choice', labelKey: 'motiondiag.param.quantity', choices: terms(['sg_result', 'cs_actual']), default: 'sg_result' },
    ],
  },
  {
    fn: 'status',
    group: 'raw',
    labelKey: 'motiondiag.fn.status',
    descKey: 'motiondiag.fnDesc.status',
    available: () => true,
    params: (_a, info) => [{ key: 'field', kind: 'text', labelKey: 'motiondiag.param.statusField', default: info.statusFields[0] ?? '', suggest: info.statusFields }],
  },

  // ---- derived datasets (analyzers.py) ----
  {
    fn: 'derivative',
    group: 'derived',
    labelKey: 'motiondiag.fn.derivative',
    descKey: 'motiondiag.fnDesc.derivative',
    available: () => true,
    params: () => [dataset('source', 'motiondiag.param.input')],
  },
  {
    fn: 'integral',
    group: 'derived',
    labelKey: 'motiondiag.fn.integral',
    descKey: 'motiondiag.fnDesc.integral',
    available: () => true,
    params: (args) => {
      const list: ParamDef[] = [dataset('source', 'motiondiag.param.input'), dataset('ref', 'motiondiag.param.reference', true)];
      // The half-life only means something with a reference to pull towards.
      if (args.ref !== undefined && args.ref !== '') {
        list.push({ key: 'halfLife', kind: 'number', labelKey: 'motiondiag.param.halfLife', optional: true, default: '0.015', min: 0.001, step: 0.005 });
      }
      return list;
    },
  },
  {
    fn: 'norm2',
    group: 'derived',
    labelKey: 'motiondiag.fn.norm2',
    descKey: 'motiondiag.fnDesc.norm2',
    available: () => true,
    params: () => [dataset('a', 'motiondiag.param.input'), dataset('b', 'motiondiag.param.input'), dataset('c', 'motiondiag.param.input', true)],
  },
  {
    fn: 'smooth',
    group: 'derived',
    labelKey: 'motiondiag.fn.smooth',
    descKey: 'motiondiag.fnDesc.smooth',
    available: () => true,
    params: () => [
      dataset('source', 'motiondiag.param.input'),
      { key: 'time', kind: 'number', labelKey: 'motiondiag.param.smoothSec', optional: true, default: '0.01', min: 0.0001, step: 0.001 },
    ],
  },
  {
    fn: 'sos',
    group: 'derived',
    labelKey: 'motiondiag.fn.sos',
    descKey: 'motiondiag.fnDesc.sos',
    available: () => true,
    params: (args) => sosParams(args),
  },
  {
    fn: 'kin',
    group: 'derived',
    labelKey: 'motiondiag.fn.kin',
    descKey: 'motiondiag.fnDesc.kin',
    available: (info) => (info.kinematics === 'cartesian' || info.kinematics === 'corexy') && info.subscriptions.includes('trapq:toolhead'),
    params: () => [
      { key: 'stepper', kind: 'choice', labelKey: 'motiondiag.param.stepper', choices: lit(['stepper_x', 'stepper_y', 'stepper_z']), default: 'stepper_x' },
    ],
  },
  {
    fn: 'corexy',
    group: 'derived',
    labelKey: 'motiondiag.fn.corexy',
    descKey: 'motiondiag.fnDesc.corexy',
    available: () => true,
    params: () => [
      { key: 'axis', kind: 'choice', labelKey: 'motiondiag.param.axis', choices: terms(['x', 'y']), default: 'x' },
      dataset('a', 'motiondiag.param.stepperA'),
      dataset('b', 'motiondiag.param.stepperB'),
    ],
  },
  {
    fn: 'deviation',
    group: 'derived',
    labelKey: 'motiondiag.fn.deviation',
    descKey: 'motiondiag.fnDesc.deviation',
    available: () => true,
    params: () => [dataset('a', 'motiondiag.param.minuend'), dataset('b', 'motiondiag.param.subtrahend')],
  },
];

export function findFunc(fn: string): FuncDef | undefined {
  return FUNCS.find((f) => f.fn === fn);
}

/** Functions this capture can provide, raw ones first. */
export function availableFuncs(info: CaptureInfo): FuncDef[] {
  return FUNCS.filter((f) => f.available(info));
}

/**
 * Adds the parameters a node is missing, with their defaults (nested dataset parameters get
 * a default raw dataset). Parameters can appear as earlier ones are filled in (the filter
 * type of `sos` decides the rest), so it repeats until nothing is added.
 */
export function completeNode(node: Node, info: CaptureInfo, depth = 0): Node {
  const def = findFunc(node.fn);
  if (!def) throw new MotanError(`Unknown dataset type '${node.fn}'`);
  for (let guard = 0; guard < 12; guard++) {
    let added = false;
    for (const p of def.params(node.args, info)) {
      if (p.key in node.args) continue;
      if (p.optional) {
        // Left unset: the form shows `default` as a placeholder, motan applies it itself.
        node.args[p.key] = '';
      } else if (p.kind === 'dataset') {
        const inner = depth < 4 ? availableFuncs(info).find((f) => f.group === 'raw') : undefined;
        node.args[p.key] = inner ? defaultNode(inner.fn, info, depth + 1) : '';
      } else {
        node.args[p.key] = p.default ?? '';
      }
      added = true;
    }
    if (!added) break;
  }
  return node;
}

/** A new node of `fn` filled with the parameter defaults. */
export function defaultNode(fn: string, info: CaptureInfo, depth = 0): Node {
  return completeNode({ fn, args: {} }, info, depth);
}

/**
 * The motan name of a node: positional arguments, trailing empty optional ones dropped.
 * Throws a MotanError for a missing required argument or one that breaks the notation.
 */
export function nodeToName(node: Node, info: CaptureInfo): string {
  const def = findFunc(node.fn);
  if (!def) throw new MotanError(`Unknown dataset type '${node.fn}'`);
  const parts: string[] = [];
  for (const p of def.params(node.args, info)) {
    const v = node.args[p.key];
    if (v === undefined || v === '') {
      if (!p.optional) throw new MotanError(`'${node.fn}': ${p.key} is required`);
      parts.push('');
      continue;
    }
    if (typeof v === 'string') {
      if (/[(),]/.test(v)) throw new MotanError(`'${v}' cannot be used in a dataset name`);
      parts.push(v);
    } else {
      parts.push(nodeToName(v, info));
    }
  }
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  // An optional gap followed by a value (an empty `what` before a later argument) cannot be written.
  if (parts.includes('')) throw new MotanError(`'${node.fn}': an optional argument is empty but a later one is set`);
  return `${node.fn}(${parts.join(',')})`;
}

/** Parses a motan dataset name into a Node. */
export function parseName(name: string, info: CaptureInfo): Node {
  const parts = nameSplit(name.trim());
  const fn = parts[0]!;
  const def = findFunc(fn);
  if (!def) throw new MotanError(`Unknown dataset '${fn}'`);
  const node: Node = { fn, args: {} };
  for (let i = 1; i < parts.length; i++) {
    const p = def.params(node.args, info)[i - 1];
    if (!p) throw new MotanError(`Invalid number of parameters for '${name}'`);
    node.args[p.key] = p.kind === 'dataset' ? parseName(parts[i]!, info) : parts[i]!;
  }
  // Optional parameters that were not written stay empty (the form shows them as unset).
  for (const p of def.params(node.args, info)) {
    if (!(p.key in node.args)) node.args[p.key] = p.optional ? '' : (p.default ?? '');
  }
  return node;
}
