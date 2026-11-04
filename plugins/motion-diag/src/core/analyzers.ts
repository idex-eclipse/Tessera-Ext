/**
 * Derived datasets: a port of the analyzers of motan's analyzers.py.
 *
 * An analyzer works on whole, already sampled datasets (all on the same time grid) and
 * produces another dataset. Where motan prints a Python float, the results here are
 * Float64Arrays holding the same IEEE doubles, computed in the same order.
 */
import { butterSos, notchSos, sosfilt, sosfiltfilt, sosfiltZi, type BandType, type Sos } from './dsp';
import { pyFixed, pyRound } from './py';
import { MotanError, type DatasetLabel, type StatusTree } from './types';

/** What an analyzer may ask its manager for (the AnalyzerManager of analyzers.py). */
export interface AnalyzerHost {
  readonly segmentTime: number;
  readonly initialStatus: StatusTree;
  /** Registers `name` (and everything it depends on) for generation. */
  setupDataset(name: string): void;
  getLabel(name: string): DatasetLabel;
  /** Data of an already generated dataset. */
  getData(name: string): Float64Array;
}

export interface Analyzer {
  label(): DatasetLabel;
  generate(): Float64Array;
}

interface AnalyzerSpec {
  parametersMin: number;
  parametersMax: number;
  create(host: AnalyzerHost, parts: string[]): Analyzer;
}

/** `text.replace(old, new).replace(old.lower(), new.lower())`, as motan renames units. */
function renameBoth(text: string, pairs: Array<[string, string]>): string {
  let out = text;
  for (const [from, to] of pairs) {
    out = out.split(from).join(to).split(from.toLowerCase()).join(to.toLowerCase());
  }
  return out;
}

/** Python `float(text)`: whole string must be a number. */
function pyFloat(text: string, what: string): number {
  const v = Number(text);
  if (text.trim() === '' || Number.isNaN(v)) throw new MotanError(`${what} '${text}' is not a number`);
  return v;
}

/** Python `int(text)`: whole string must be an integer. */
function pyInt(text: string, what: string): number {
  if (!/^\s*[+-]?\d+\s*$/.test(text)) throw new MotanError(`${what} '${text}' is not an integer`);
  return Number(text);
}

// ---------------------------------------------------------------------------------------

class Derivative implements Analyzer {
  private readonly source: string;
  constructor(private readonly host: AnalyzerHost, parts: string[]) {
    this.source = parts[1]!;
    host.setupDataset(this.source);
  }

  label(): DatasetLabel {
    const { label, units } = this.host.getLabel(this.source);
    let pairs: Array<[string, string]>;
    if (units.includes('(mm)')) {
      pairs = [['Position', 'Velocity'], ['(mm)', '(mm/s)']];
    } else if (units.includes('(mm/s)')) {
      pairs = [['Velocity', 'Acceleration'], ['(mm/s)', '(mm/s^2)']];
    } else {
      return { label: `Derivative of ${label}`, units: 'Unknown' };
    }
    return { label: renameBoth(label, pairs), units: renameBoth(units, pairs) };
  }

  generate(): Float64Array {
    const inv = 1 / this.host.segmentTime;
    const data = this.host.getData(this.source);
    const out = new Float64Array(data.length);
    for (let i = 0; i < data.length - 1; i++) out[i + 1] = (data[i + 1]! - data[i]!) * inv;
    // motan repeats the first difference to keep the length.
    out[0] = out[1] ?? 0;
    return out;
  }
}

class Integral implements Analyzer {
  private readonly source: string;
  private readonly ref: string | null;
  private readonly halfLife: number;

  constructor(private readonly host: AnalyzerHost, parts: string[]) {
    this.source = parts[1]!;
    host.setupDataset(this.source);
    this.ref = null;
    this.halfLife = 0.015;
    if (parts.length >= 3) {
      this.ref = parts[2]!;
      host.setupDataset(this.ref);
      if (parts.length === 4) this.halfLife = pyFloat(parts[3]!, 'Half-life');
    }
  }

  label(): DatasetLabel {
    const { label, units } = this.host.getLabel(this.source);
    let pairs: Array<[string, string]>;
    if (units.includes('(mm/s)')) {
      pairs = [['Velocity', 'Position'], ['(mm/s)', '(mm)']];
    } else if (units.includes('(mm/s^2)')) {
      pairs = [['Acceleration', 'Velocity'], ['(mm/s^2)', '(mm/s)']];
    } else {
      return { label: 'Integral', units: 'Unknown' };
    }
    return { label: renameBoth(label, pairs), units: renameBoth(units, pairs) };
  }

  generate(): Float64Array {
    const seg = this.host.segmentTime;
    const src = this.host.getData(this.source);
    let offset = 0;
    for (const v of src) offset += v;
    offset /= src.length;
    let total = 0;
    let ref: Float64Array | null = null;
    let srcWeight = 1;
    let refWeight = 0;
    if (this.ref !== null) {
      ref = this.host.getData(this.ref);
      offset -= (ref[ref.length - 1]! - ref[0]!) / (src.length * seg);
      total = ref[0]!;
      if (this.halfLife) srcWeight = Math.exp((Math.log(0.5) * seg) / this.halfLife);
      refWeight = 1 - srcWeight;
    }
    const data = new Float64Array(src.length);
    for (let i = 0; i < src.length; i++) {
      total += (src[i]! - offset) * seg;
      if (ref !== null) total = srcWeight * total + refWeight * ref[i]!;
      data[i] = total;
    }
    return data;
  }
}

class Norm2 implements Analyzer {
  private readonly sources: string[];
  constructor(private readonly host: AnalyzerHost, parts: string[]) {
    this.sources = parts.slice(1);
    for (const s of this.sources) host.setupDataset(s);
  }

  label(): DatasetLabel {
    const { label, units } = this.host.getLabel(this.sources[0]!);
    const kinds = ['position', 'velocity', 'acceleration'];
    const dataName = kinds.find((d) => label.includes(d)) ?? '';
    let lname = '';
    for (const s of this.sources) {
      let l = this.host.getLabel(s).label;
      for (const r of kinds) l = l.split(r).join('').trim();
      if (lname) lname += '+';
      lname += l;
    }
    lname += ` ${dataName} norm2`;
    return { label: lname, units };
  }

  generate(): Float64Array {
    const data = this.sources.map((s) => this.host.getData(s));
    const res = new Float64Array(data[0]!.length);
    for (let i = 0; i < res.length; i++) {
      let norm2 = 0;
      for (const d of data) norm2 += d[i]! * d[i]!;
      res[i] = Math.sqrt(norm2);
    }
    return res;
  }
}

class Smoothed implements Analyzer {
  private readonly source: string;
  private readonly smoothTime: number;
  constructor(private readonly host: AnalyzerHost, parts: string[]) {
    this.source = parts[1]!;
    host.setupDataset(this.source);
    this.smoothTime = parts.length > 2 ? pyFloat(parts[2]!, 'Smooth time') : 0.01;
  }

  label(): DatasetLabel {
    const { label, units } = this.host.getLabel(this.source);
    return { label: `Smoothed ${label}`, units };
  }

  generate(): Float64Array {
    const src = this.host.getData(this.source);
    const n = src.length;
    const hst = 0.5 * this.smoothTime;
    const half = pyRound(hst / this.host.segmentTime);
    let norm = 0;
    for (let k = 0; k < 2 * half; k++) norm += Math.min(k + 1, half + half - k);
    if (norm === 0) throw new MotanError('The smoothing time is shorter than the sampling step');
    const inv = 1 / norm;
    const data = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = Math.max(0, i - half);
      const je = Math.min(n, i + half);
      let avg = 0;
      for (let k = 0; k < je - j; k++) avg += src[j + k]! * Math.min(k + 1, half + half - k);
      data[i] = avg * inv;
    }
    return data;
  }
}

class SosFilter implements Analyzer {
  private readonly source: string;
  private readonly type: 'filt' | 'filtfilt';
  private readonly sos: Sos;
  private readonly desc: string;

  constructor(private readonly host: AnalyzerHost, parts: string[]) {
    this.source = parts[1]!;
    const type = parts[2]!;
    if (type !== 'filt' && type !== 'filtfilt') throw new MotanError(`Unknown sos type '${type}'`);
    this.type = type;
    const filterType = parts[3]!;
    host.setupDataset(this.source);
    const fs = 1 / host.segmentTime;
    if (filterType === 'highpass' || filterType === 'lowpass' || filterType === 'bandpass') {
      const order = pyInt(parts[4]!, 'Filter order');
      let cutoff: number | [number, number] = pyFloat(parts[5]!, 'Cutoff');
      let desc = `${pyFixed(cutoff, 0)}Hz`;
      if (filterType === 'bandpass') {
        if (parts.length < 7) throw new MotanError("A bandpass filter needs a low and a high frequency");
        cutoff = [cutoff, pyFloat(parts[6]!, 'Cutoff')];
        desc = `${pyFixed(cutoff[0], 1)}..${pyFixed(cutoff[1], 1)}Hz`;
      }
      this.sos = butterSos(order, cutoff, filterType as BandType, fs);
      this.desc = `${filterType} ${desc} order ${order}`;
    } else if (filterType === 'notch') {
      const freq = pyFloat(parts[4]!, 'Frequency');
      const quality = pyFloat(parts[5]!, 'Quality');
      this.sos = notchSos(freq, quality, fs);
      this.desc = `notch ${pyFixed(freq, 1)}Hz Q: ${pyFixed(quality, 1)}`;
    } else {
      throw new MotanError(`Unknown filter type '${filterType}'`);
    }
  }

  label(): DatasetLabel {
    const { label, units } = this.host.getLabel(this.source);
    return { label: `SOS ${this.desc} (${label})`, units };
  }

  generate(): Float64Array {
    const data = this.host.getData(this.source);
    if (this.type === 'filt') {
      const x0 = data[0]!;
      const zi = sosfiltZi(this.sos).map(([a, b]) => [a * x0, b * x0] as [number, number]);
      return sosfilt(this.sos, data, zi);
    }
    return sosfiltfilt(this.sos, data);
  }
}

/** Stepper position derived from the toolhead position (cartesian and corexy only, like motan). */
class KinematicPosition implements Analyzer {
  private readonly source1: string;
  private readonly source2: string | null;
  private readonly mode: 'plus' | 'minus' | 'pass';

  constructor(private readonly host: AnalyzerHost, parts: string[]) {
    const stepper = parts[1]!;
    const printer = (host.initialStatus.configfile?.settings as Record<string, Record<string, unknown>> | undefined)?.printer;
    const kin = printer?.kinematics;
    if (kin !== 'cartesian' && kin !== 'corexy') throw new MotanError(`Unsupported kinematics '${String(kin)}'`);
    if (stepper !== 'stepper_x' && stepper !== 'stepper_y' && stepper !== 'stepper_z') {
      throw new MotanError(`Unknown stepper '${stepper}'`);
    }
    if (kin === 'corexy' && (stepper === 'stepper_x' || stepper === 'stepper_y')) {
      this.source1 = 'trapq(toolhead,x)';
      this.source2 = 'trapq(toolhead,y)';
      this.mode = stepper === 'stepper_x' ? 'plus' : 'minus';
      host.setupDataset(this.source1);
      host.setupDataset(this.source2);
    } else {
      this.source1 = `trapq(toolhead,${stepper.slice(-1)})`;
      this.source2 = null;
      this.mode = 'pass';
      host.setupDataset(this.source1);
    }
  }

  label(): DatasetLabel {
    return { label: 'Position', units: 'Position\n(mm)' };
  }

  generate(): Float64Array {
    const d1 = this.host.getData(this.source1);
    if (this.mode === 'pass') return d1;
    const d2 = this.host.getData(this.source2!);
    const out = new Float64Array(d1.length);
    const sign = this.mode === 'plus' ? 1 : -1;
    for (let i = 0; i < out.length; i++) out[i] = d1[i]! + sign * d2[i]!;
    return out;
  }
}

/** Toolhead x/y derived from the positions of two corexy steppers. */
class CorexyPosition implements Analyzer {
  private readonly isPlus: boolean;
  private readonly source1: string;
  private readonly source2: string;

  constructor(private readonly host: AnalyzerHost, parts: string[]) {
    this.isPlus = parts[1] === 'x';
    this.source1 = parts[2]!;
    this.source2 = parts[3]!;
    host.setupDataset(this.source1);
    host.setupDataset(this.source2);
  }

  label(): DatasetLabel {
    return { label: `Derived ${this.isPlus ? 'x' : 'y'} position`, units: 'Position\n(mm)' };
  }

  generate(): Float64Array {
    const d1 = this.host.getData(this.source1);
    const d2 = this.host.getData(this.source2);
    const out = new Float64Array(d1.length);
    for (let i = 0; i < out.length; i++) out[i] = 0.5 * (this.isPlus ? d1[i]! + d2[i]! : d1[i]! - d2[i]!);
    return out;
  }
}

class Deviation implements Analyzer {
  private readonly source1: string;
  private readonly source2: string;
  constructor(private readonly host: AnalyzerHost, parts: string[]) {
    this.source1 = parts[1]!;
    this.source2 = parts[2]!;
    host.setupDataset(this.source1);
    host.setupDataset(this.source2);
  }

  label(): DatasetLabel {
    const l1 = this.host.getLabel(this.source1);
    const l2 = this.host.getLabel(this.source2);
    if (l1.units !== l2.units) return { label: 'Deviation', units: 'Unknown' };
    const lines = l1.units.split('\n');
    return { label: `${l1.label} deviation`, units: [lines[0]!, 'Deviation', ...lines.slice(1)].join('\n') };
  }

  generate(): Float64Array {
    const d1 = this.host.getData(this.source1);
    const d2 = this.host.getData(this.source2);
    const out = new Float64Array(d1.length);
    for (let i = 0; i < out.length; i++) out[i] = d1[i]! - d2[i]!;
    return out;
  }
}

const ANALYZERS: Record<string, AnalyzerSpec> = {
  derivative: { parametersMin: 1, parametersMax: 1, create: (h, p) => new Derivative(h, p) },
  integral: { parametersMin: 1, parametersMax: 3, create: (h, p) => new Integral(h, p) },
  norm2: { parametersMin: 2, parametersMax: 3, create: (h, p) => new Norm2(h, p) },
  smooth: { parametersMin: 1, parametersMax: 2, create: (h, p) => new Smoothed(h, p) },
  sos: { parametersMin: 5, parametersMax: 6, create: (h, p) => new SosFilter(h, p) },
  kin: { parametersMin: 1, parametersMax: 1, create: (h, p) => new KinematicPosition(h, p) },
  corexy: { parametersMin: 3, parametersMax: 3, create: (h, p) => new CorexyPosition(h, p) },
  deviation: { parametersMin: 2, parametersMax: 2, create: (h, p) => new Deviation(h, p) },
};

/** Creates the analyzer for `parts` (the split dataset name), or throws a MotanError. */
export function createAnalyzer(host: AnalyzerHost, name: string, parts: string[]): Analyzer {
  const spec = Object.hasOwn(ANALYZERS, parts[0]!) ? ANALYZERS[parts[0]!] : undefined;
  if (!spec) throw new MotanError(`Unknown dataset '${name}'`);
  const given = parts.length - 1;
  if (given < spec.parametersMin || given > spec.parametersMax) {
    throw new MotanError(`Invalid parameters to dataset '${name}'`);
  }
  return spec.create(host, parts);
}
