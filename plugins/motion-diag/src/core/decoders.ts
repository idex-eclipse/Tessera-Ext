/**
 * Raw dataset decoders: a port of the log data handlers of motan's readlog.py.
 *
 * Every decoder is sampled with `pull(t)` for increasing print times `t` and returns the
 * value of its quantity at `t`. The decoders keep motan's exact arithmetic (including its
 * edge behaviour, e.g. extrapolation before the first sample), because the result has to
 * match motan's CSV. Python raises on a division by zero where JavaScript yields NaN or
 * Infinity: such values are passed through and show up as gaps in the graph.
 */
import type { LogContext, MessageCursor } from './log-model';
import { nameSplit } from './names';
import { pyMod } from './py';
import { MotanError, type DatasetLabel } from './types';

export interface RawDecoder {
  label(): DatasetLabel;
  pull(reqTime: number): number;
}

interface DecoderSpec {
  /** Leading name parts that identify the subscription in the capture (0 = none). */
  subscriptionIdParts: number;
  parametersMin: number;
  parametersMax: number;
  create(ctx: LogContext, name: string, parts: string[]): RawDecoder;
}

const NAN = Number.NaN;

/** Linear interpolation between two samples (readlog.interpolate). */
function interpolate(nextVal: number, prevVal: number, nextTime: number, prevTime: number, reqTime: number): number {
  return prevVal + ((reqTime - prevTime) * (nextVal - prevVal)) / (nextTime - prevTime);
}

/** A number from a message field that may be null (sensor not ready). */
const num = (v: unknown): number => (typeof v === 'number' ? v : NAN);

/** Numeric value of a status field; motan would hand non-numbers through, a chart cannot plot them. */
function statusNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return NAN;
}

// ---------------------------------------------------------------------------------------
// status(<field>)
// ---------------------------------------------------------------------------------------

class StatusField implements RawDecoder {
  private readonly tracker;
  private readonly fieldName: string;
  private readonly fieldParts: string[];
  private nextUpdateTime = 0;
  private result = NAN;
  private hasResult = false;

  constructor(ctx: LogContext, parts: string[]) {
    this.tracker = ctx.statusTracker();
    this.fieldName = parts[1]!;
    this.fieldParts = this.fieldName.split('.');
  }

  label(): DatasetLabel {
    return { label: `${this.fieldName} field`, units: 'Unknown' };
  }

  pull(reqTime: number): number {
    if (this.hasResult && reqTime < this.nextUpdateTime) return this.result;
    const { status, validUntil } = this.tracker.pullStatus(reqTime);
    let db: unknown = status;
    for (const fp of this.fieldParts.slice(0, -1)) {
      db = db !== null && typeof db === 'object' ? ((db as Record<string, unknown>)[fp] ?? {}) : {};
    }
    const leaf = db !== null && typeof db === 'object' ? (db as Record<string, unknown>)[this.fieldParts.at(-1)!] : undefined;
    // A missing field reads as 0, like motan.
    this.result = leaf === undefined ? 0 : statusNumber(leaf);
    this.hasResult = true;
    this.nextUpdateTime = validUntil;
    return this.result;
  }
}

// ---------------------------------------------------------------------------------------
// trapq(<name>,<selection>)
// ---------------------------------------------------------------------------------------

type Vec3 = [number, number, number];
/** [print_time, move_t, start_v, accel, start_pos, axes_r] */
type Move = [number, number, number, number, Vec3, Vec3];

const AXES = 'xyz';

class TrapQ implements RawDecoder {
  private readonly cursor: MessageCursor<{ data: Move[] }>;
  private cur: Move[] = [[0, 0, 0, 0, [0, 0, 0], [0, 0, 0]]];
  private dataPos = 0;
  private readonly lbl: DatasetLabel;
  private readonly axis: number;
  private readonly kind: 'velocity' | 'accel' | 'pos' | 'axis_velocity' | 'axis_accel';

  constructor(ctx: LogContext, name: string, parts: string[]) {
    this.cursor = ctx.cursor(`${parts[0]}:${parts[1]}`);
    const trapqName = parts[1]!;
    const sel = parts[2]!;
    this.axis = 0;
    if (sel === 'velocity') {
      this.kind = 'velocity';
      this.lbl = { label: `${trapqName} velocity`, units: 'Velocity\n(mm/s)' };
    } else if (sel === 'accel') {
      this.kind = 'accel';
      this.lbl = { label: `${trapqName} acceleration`, units: 'Acceleration\n(mm/s^2)' };
    } else {
      const m = /^([xyz])(_velocity|_accel)?$/.exec(sel);
      if (!m) throw new MotanError(`Unknown trapq data selection '${sel}'`);
      this.axis = AXES.indexOf(m[1]!);
      if (m[2] === '_velocity') {
        this.kind = 'axis_velocity';
        this.lbl = { label: `${trapqName} ${m[1]} velocity`, units: 'Velocity\n(mm/s)' };
      } else if (m[2] === '_accel') {
        this.kind = 'axis_accel';
        this.lbl = { label: `${trapqName} ${m[1]} acceleration`, units: 'Acceleration\n(mm/s^2)' };
      } else {
        this.kind = 'pos';
        this.lbl = { label: `${trapqName} ${m[1]} position`, units: 'Position\n(mm)' };
      }
    }
    void name;
  }

  label(): DatasetLabel {
    return this.lbl;
  }

  private findMove(reqTime: number): { move: Move; inRange: boolean } {
    let dataPos = this.dataPos;
    for (;;) {
      const move = this.cur[dataPos]!;
      const [printTime, moveT] = move;
      if (reqTime <= printTime + moveT) return { move, inRange: reqTime >= printTime };
      dataPos += 1;
      if (dataPos < this.cur.length) {
        this.dataPos = dataPos;
        continue;
      }
      const msg = this.cursor.pull();
      if (msg === null) return { move, inRange: false };
      if (msg.data.length === 0) {
        // Nothing to read in an empty message; keep the last move as the answer.
        dataPos -= 1;
        continue;
      }
      this.cur = msg.data;
      this.dataPos = dataPos = 0;
    }
  }

  pull(reqTime: number): number {
    const { move, inRange } = this.findMove(reqTime);
    const [printTime, moveT, startV, accel, startPos, axesR] = move;
    switch (this.kind) {
      case 'pos': {
        const mtime = Math.max(0, Math.min(moveT, reqTime - printTime));
        const dist = (startV + 0.5 * accel * mtime) * mtime;
        return startPos[this.axis]! + axesR[this.axis]! * dist;
      }
      case 'axis_velocity':
        return inRange ? (startV + accel * (reqTime - printTime)) * axesR[this.axis]! : 0;
      case 'axis_accel':
        return inRange ? accel * axesR[this.axis]! : 0;
      case 'velocity':
        return inRange ? startV + accel * (reqTime - printTime) : 0;
      case 'accel':
        return inRange ? accel : 0;
    }
  }
}

// ---------------------------------------------------------------------------------------
// Step queue blocks (stepq and step_phase)
// ---------------------------------------------------------------------------------------

/** One `motion_report/dump_stepper` message. */
interface StepBlock {
  data: Array<[number, number, number]>;
  start_position: number;
  start_mcu_position: number;
  step_distance: number;
  first_clock: number;
  first_step_time: number;
  last_clock: number;
  last_step_time: number;
}

/**
 * Reads blocks until one that covers `reqTime`; null when the capture ends first.
 * Shared by stepq and step_phase, which differ only in what they derive from a block.
 */
function nextCoveringBlock(cursor: MessageCursor<StepBlock>, reqTime: number): StepBlock | null {
  for (;;) {
    const block = cursor.pull();
    if (block === null) return null;
    if (reqTime <= block.last_step_time) return block;
  }
}

/** Seconds per MCU clock tick within a block (motan assumes it is constant over a block). */
function invFreq(block: StepBlock): number {
  const cdiff = block.last_clock - block.first_clock;
  const tdiff = block.last_step_time - block.first_step_time;
  return cdiff ? tdiff / cdiff : 0;
}

class StepQ implements RawDecoder {
  private readonly cursor: MessageCursor<StepBlock>;
  private readonly stepperName: string;
  private readonly smoothTime: number;
  // Parallel arrays of (time, half position, position) per step, motan's step_data.
  private times = [0, 0];
  private halves = [0, 0];
  private positions = [0, 0];
  private dataPos = 0;

  constructor(ctx: LogContext, name: string, parts: string[]) {
    this.stepperName = parts[1]!;
    this.cursor = ctx.cursor(`stepq:${this.stepperName}`);
    this.smoothTime = 0.01;
    if (parts.length === 3) {
      const v = Number(parts[2]);
      if (parts[2]!.trim() === '' || Number.isNaN(v)) throw new MotanError(`Invalid stepq smooth time '${parts[2]}'`);
      this.smoothTime = v;
    }
    void name;
  }

  label(): DatasetLabel {
    return { label: `${this.stepperName} position`, units: 'Position\n(mm)' };
  }

  pull(reqTime: number): number {
    const smooth = this.smoothTime;
    for (;;) {
      const dp = this.dataPos;
      const nextTime = this.times[dp + 1]!;
      if (reqTime >= nextTime) {
        if (dp + 2 < this.times.length) {
          this.dataPos = dp + 1;
          continue;
        }
        this.pullBlock(reqTime);
        continue;
      }
      const nextHalf = this.halves[dp + 1]!;
      const lastTime = this.times[dp]!;
      const lastHalf = this.halves[dp]!;
      const lastPos = this.positions[dp]!;
      // Step smoothing: a step is spread over `smooth` seconds around its time.
      let rtdiff = reqTime - lastTime;
      let stime = nextTime - lastTime;
      if (stime <= smooth) {
        const pdiff = nextHalf - lastHalf;
        return lastHalf + (rtdiff * pdiff) / stime;
      }
      stime = 0.5 * smooth;
      if (rtdiff < stime) {
        const pdiff = lastPos - lastHalf;
        return lastHalf + (rtdiff * pdiff) / stime;
      }
      rtdiff = nextTime - reqTime;
      if (rtdiff < stime) {
        const pdiff = lastPos - nextHalf;
        return nextHalf + (rtdiff * pdiff) / stime;
      }
      return lastPos;
    }
  }

  private pullBlock(reqTime: number): void {
    // Keep only the last step of the previous block as the start of the new one.
    const n = this.times.length - 1;
    this.times = [this.times[n]!];
    this.halves = [this.halves[n]!];
    this.positions = [this.positions[n]!];
    this.dataPos = 0;

    const block = nextCoveringBlock(this.cursor, reqTime);
    if (block === null) {
      // No more data: hold the last position, extending the queue past `reqTime`.
      const lastPos = this.positions[0]!;
      this.times.push(reqTime + 0.1);
      this.halves.push(lastPos);
      this.positions.push(lastPos);
      return;
    }
    const firstTime = block.first_step_time;
    const firstClock = block.first_clock;
    let stepClock = firstClock - block.data[0]![0];
    const inv = invFreq(block);
    const stepDist = block.step_distance;
    let stepPos = block.start_position;
    if (!this.times[0]) {
      this.times[0] = 0;
      this.halves[0] = stepPos;
      this.positions[0] = stepPos;
    }
    for (const entry of block.data) {
      let interval = entry[0];
      const rawCount = entry[1];
      const add = entry[2];
      let qsDist = stepDist;
      let count = rawCount;
      if (count < 0) {
        qsDist = -qsDist;
        count = -count;
      }
      for (let i = 0; i < count; i++) {
        stepClock += interval;
        interval += add;
        this.times.push(firstTime + (stepClock - firstClock) * inv);
        this.halves.push(stepPos + 0.5 * qsDist);
        stepPos += qsDist;
        this.positions.push(stepPos);
      }
    }
  }
}

class StepPhase implements RawDecoder {
  private readonly cursor: MessageCursor<StepBlock>;
  private readonly driverName: string;
  private readonly stepperName: string;
  private readonly reportMicrosteps: boolean;
  private readonly phases: number;
  private readonly tracker;
  private times = [0, 0];
  private positions = [0, 0];
  private dataPos = 0;
  private nextStatusTime = 0;
  private mcuPhaseOffset = 0;

  constructor(ctx: LogContext, name: string, parts: string[]) {
    this.driverName = parts[1]!;
    this.stepperName = this.driverName.split(/\s+/).filter(Boolean).slice(1).join(' ');
    const config = ctx.config;
    if (!(this.driverName in config) || !(this.stepperName in config)) {
      throw new MotanError(`Unable to find stepper driver '${this.driverName}' config`);
    }
    if (parts.length === 3 && parts[2] !== 'microstep') throw new MotanError(`Unknown step_phase selection '${parts[2]}'`);
    this.reportMicrosteps = parts.length === 3;
    const microsteps = config[this.stepperName]!.microsteps;
    if (typeof microsteps !== 'number') throw new MotanError(`Stepper '${this.stepperName}' has no microsteps in its config`);
    this.phases = this.reportMicrosteps ? microsteps : microsteps * 4;
    // The phase is derived from the stepper's own step queue.
    this.cursor = ctx.cursor(`stepq:${this.stepperName}`);
    this.tracker = ctx.statusTracker();
    void name;
  }

  label(): DatasetLabel {
    if (this.reportMicrosteps) return { label: `${this.stepperName} microstep`, units: 'Microstep' };
    return { label: `${this.stepperName} phase`, units: 'Phase' };
  }

  private pullPhaseOffset(reqTime: number): void {
    const { status, validUntil } = this.tracker.pullStatus(reqTime);
    this.nextStatusTime = validUntil;
    const offset = status[this.driverName]?.mcu_phase_offset;
    this.mcuPhaseOffset = typeof offset === 'number' ? offset : 0;
  }

  pull(reqTime: number): number {
    if (reqTime >= this.nextStatusTime) this.pullPhaseOffset(reqTime);
    for (;;) {
      const dp = this.dataPos;
      const nextTime = this.times[dp + 1]!;
      if (reqTime >= nextTime) {
        if (dp + 2 < this.times.length) {
          this.dataPos = dp + 1;
          continue;
        }
        this.pullBlock(reqTime);
        continue;
      }
      return pyMod(this.positions[dp]! + this.mcuPhaseOffset, this.phases);
    }
  }

  private pullBlock(reqTime: number): void {
    const n = this.times.length - 1;
    this.times = [this.times[n]!];
    this.positions = [this.positions[n]!];
    this.dataPos = 0;

    const block = nextCoveringBlock(this.cursor, reqTime);
    if (block === null) {
      const lastPos = this.positions[0]!;
      this.times.push(reqTime + 0.1);
      this.positions.push(lastPos);
      return;
    }
    const firstTime = block.first_step_time;
    const firstClock = block.first_clock;
    let stepClock = firstClock - block.data[0]![0];
    const inv = invFreq(block);
    let stepPos = block.start_mcu_position;
    if (!this.times[0]) {
      this.times[0] = 0;
      this.positions[0] = stepPos;
    }
    for (const entry of block.data) {
      let interval = entry[0];
      const rawCount = entry[1];
      const add = entry[2];
      let qsDist = 1;
      let count = rawCount;
      if (count < 0) {
        qsDist = -1;
        count = -count;
      }
      for (let i = 0; i < count; i++) {
        stepClock += interval;
        interval += add;
        this.times.push(firstTime + (stepClock - firstClock) * inv);
        stepPos += qsDist;
        this.positions.push(stepPos);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------
// stallguard(<stepper>,<sg_result|cs_actual>)
// ---------------------------------------------------------------------------------------

class Stallguard implements RawDecoder {
  private readonly cursor: MessageCursor<{ data: Array<[number, number, number]> }>;
  private readonly stepperName: string;
  private readonly filter: 'sg_result' | 'cs_actual';
  private driverName = '';
  private data: Array<[number, number, number]> = [];
  private dataPos = 0;
  private ret: [number, number, number] | null = null;

  constructor(ctx: LogContext, name: string, parts: string[]) {
    this.stepperName = parts[1]!;
    const filter = parts[2]!;
    if (filter !== 'sg_result' && filter !== 'cs_actual') throw new MotanError(`Unknown stallguard selection '${filter}'`);
    this.filter = filter;
    this.cursor = ctx.cursor(`stallguard:${this.stepperName}`);
    // The driver section that belongs to the stepper, e.g. "tmc2209 stepper_x".
    for (const key of Object.keys(ctx.config)) {
      if (key.startsWith('tmc') && key.endsWith(this.stepperName)) {
        this.driverName = key;
        break;
      }
    }
    void name;
  }

  label(): DatasetLabel {
    const label = `${this.driverName} ${this.stepperName} ${this.filter}`;
    return { label, units: this.filter === 'sg_result' ? 'Stallguard' : 'CS Actual' };
  }

  pull(reqTime: number): number {
    for (;;) {
      if (this.dataPos >= this.data.length) {
        const msg = this.cursor.pull();
        if (msg === null) return NAN;
        this.data = msg.data;
        this.dataPos = 0;
      }
      if (this.ret === null && this.dataPos < this.data.length) this.ret = this.data[this.dataPos++]!;
      if (this.ret !== null) {
        if (reqTime <= this.ret[0]) return this.filter === 'sg_result' ? this.ret[1] : this.ret[2];
        this.ret = null;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------
// accelerometer(<name>,<axis>)
// ---------------------------------------------------------------------------------------

class Accelerometer implements RawDecoder {
  private readonly cursor: MessageCursor<{ data: Array<[number, number, number, number]> }>;
  private readonly accelName: string;
  private readonly axis: number;
  private nextTime = 0;
  private lastTime = 0;
  private next: Vec3 = [0, 0, 0];
  private last: Vec3 = [0, 0, 0];
  private cur: Array<[number, number, number, number]> = [];
  private dataPos = 0;

  constructor(ctx: LogContext, name: string, parts: string[]) {
    this.accelName = parts[1]!;
    // parts[0] is "accelerometer", or "adxl345" for captures that still use the old name.
    this.cursor = ctx.cursor(`${parts[0]}:${this.accelName}`);
    const sel = parts[2]!;
    if (sel.length !== 1 || !AXES.includes(sel)) throw new MotanError(`Unknown accelerometer data selection '${name}'`);
    this.axis = AXES.indexOf(sel);
  }

  label(): DatasetLabel {
    return { label: `${this.accelName} ${AXES[this.axis]} acceleration`, units: 'Acceleration\n(mm/s^2)' };
  }

  pull(reqTime: number): number {
    const axis = this.axis;
    for (;;) {
      if (reqTime <= this.nextTime) {
        const adiff = this.next[axis]! - this.last[axis]!;
        const tdiff = this.nextTime - this.lastTime;
        const rtdiff = reqTime - this.lastTime;
        return this.last[axis]! + (rtdiff * adiff) / tdiff;
      }
      if (this.dataPos >= this.cur.length) {
        const msg = this.cursor.pull();
        if (msg === null) return 0;
        this.cur = msg.data;
        this.dataPos = 0;
        continue;
      }
      this.last = this.next;
      this.lastTime = this.nextTime;
      const s = this.cur[this.dataPos++]!;
      this.nextTime = s[0];
      this.next = [s[1], s[2], s[3]];
    }
  }
}

// ---------------------------------------------------------------------------------------
// angle(<name>)
// ---------------------------------------------------------------------------------------

/** Parses a config `gear_ratio` ("80:16, 2:1") into [numerator, denominator] pairs. */
function parseGearRatio(value: unknown): Array<[number, number]> {
  if (typeof value === 'string') {
    return value.split(',').map((gr) => {
      const [n, d] = gr.split(':').map((v) => Number(v.trim()));
      return [n!, d!] as [number, number];
    });
  }
  if (Array.isArray(value)) return value.map((p) => [Number(p[0]), Number(p[1])] as [number, number]);
  return [];
}

class Angle implements RawDecoder {
  private readonly cursor: MessageCursor<{ data: Array<[number, number]>; position_offset?: number }>;
  private readonly angleName: string;
  private nextTime = 0;
  private lastTime = 0;
  private next = 0;
  private last = 0;
  private cur: Array<[number, number]> = [];
  private dataPos = 0;
  private positionOffset = 0;
  private angleDist = 1;

  constructor(ctx: LogContext, name: string, parts: string[]) {
    this.angleName = parts[1]!;
    this.cursor = ctx.cursor(`angle:${this.angleName}`);
    // One full turn of the sensor is 65536 counts; map it to the stepper's travel.
    const config = ctx.config;
    const stepperName = config[`angle ${this.angleName}`]?.stepper;
    if (typeof stepperName === 'string') {
      const sconfig = config[stepperName] ?? {};
      let rotationDistance = typeof sconfig.rotation_distance === 'number' ? sconfig.rotation_distance : 1;
      for (const [n, d] of parseGearRatio(sconfig.gear_ratio)) rotationDistance *= d / n;
      this.angleDist = rotationDistance / 65536;
    }
    void name;
  }

  label(): DatasetLabel {
    return { label: `${this.angleName} position`, units: 'Position\n(mm)' };
  }

  pull(reqTime: number): number {
    for (;;) {
      if (reqTime <= this.nextTime) {
        const pdiff = this.next - this.last;
        const tdiff = this.nextTime - this.lastTime;
        const rtdiff = reqTime - this.lastTime;
        const po = (rtdiff * pdiff) / tdiff;
        return (this.last + po) * this.angleDist + this.positionOffset;
      }
      if (this.dataPos >= this.cur.length) {
        const msg = this.cursor.pull();
        if (msg === null) return this.next * this.angleDist + this.positionOffset;
        this.cur = msg.data;
        if (typeof msg.position_offset === 'number') this.positionOffset = msg.position_offset;
        this.dataPos = 0;
        continue;
      }
      this.last = this.next;
      this.lastTime = this.nextTime;
      const s = this.cur[this.dataPos++]!;
      this.nextTime = s[0];
      this.next = s[1];
    }
  }
}

// ---------------------------------------------------------------------------------------
// ldc1612(<name>[,period|z])
// ---------------------------------------------------------------------------------------

class EddyCurrent implements RawDecoder {
  private readonly cursor: MessageCursor<{ data: Array<[number, number, number]> }>;
  private readonly sensorName: string;
  private readonly reportFrequency: boolean;
  private readonly reportZ: boolean;
  private nextSamp: [number, number, number] = [0, 0, 0];
  private prevSamp: [number, number, number] = [0, 0, 0];
  private cur: Array<[number, number, number]> = [];
  private dataPos = 0;

  constructor(ctx: LogContext, name: string, parts: string[]) {
    this.sensorName = parts[1]!;
    this.cursor = ctx.cursor(`ldc1612:${this.sensorName}`);
    if (parts.length === 3 && parts[2] !== 'period' && parts[2] !== 'z') {
      throw new MotanError(`Unknown ldc1612 selection '${parts[2]}'`);
    }
    this.reportFrequency = parts.length === 2;
    this.reportZ = parts.length === 3 && parts[2] === 'z';
    void name;
  }

  label(): DatasetLabel {
    if (this.reportFrequency) return { label: `${this.sensorName} frequency`, units: 'Frequency\n(Hz)' };
    if (this.reportZ) return { label: `${this.sensorName} height`, units: 'Position\n(mm)' };
    return { label: `${this.sensorName} period`, units: 'Period\n(s)' };
  }

  pull(reqTime: number): number {
    for (;;) {
      const [nextTime, nextFreq, nextZ] = this.nextSamp;
      if (reqTime <= nextTime) {
        const [prevTime, prevFreq, prevZ] = this.prevSamp;
        let nextVal: number;
        let prevVal: number;
        if (this.reportFrequency) {
          nextVal = nextFreq;
          prevVal = prevFreq;
        } else if (this.reportZ) {
          nextVal = nextZ;
          prevVal = prevZ;
        } else {
          nextVal = 1 / nextFreq;
          prevVal = 1 / prevFreq;
        }
        return interpolate(nextVal, prevVal, nextTime, prevTime, reqTime);
      }
      if (this.dataPos >= this.cur.length) {
        const msg = this.cursor.pull();
        if (msg === null) return 0;
        this.cur = msg.data;
        this.dataPos = 0;
        continue;
      }
      this.prevSamp = this.nextSamp;
      this.nextSamp = this.cur[this.dataPos++]!;
    }
  }
}

// ---------------------------------------------------------------------------------------
// loadcell(<name>[,counts])
// ---------------------------------------------------------------------------------------

class LoadCell implements RawDecoder {
  private readonly cursor: MessageCursor<{ data: Array<[number, number | null, number, number | null]> }>;
  private readonly sensorName: string;
  private readonly reportCounts: boolean;
  private nextSamp: [number, number | null, number, number | null] = [0, 0, 0, 0];
  private prevSamp: [number, number | null, number, number | null] = [0, 0, 0, 0];
  private cur: Array<[number, number | null, number, number | null]> = [];
  private dataPos = 0;

  constructor(ctx: LogContext, name: string, parts: string[]) {
    this.sensorName = parts[1]!;
    this.cursor = ctx.cursor(`loadcell:${this.sensorName}`);
    if (parts.length === 3 && parts[2] !== 'counts') throw new MotanError(`Unknown loadcell selection '${parts[2]}'`);
    this.reportCounts = parts.length === 3;
    void name;
  }

  label(): DatasetLabel {
    if (this.reportCounts) return { label: `${this.sensorName} counts`, units: 'ADC Counts' };
    return { label: `${this.sensorName} force`, units: 'Force\n(g)' };
  }

  pull(reqTime: number): number {
    for (;;) {
      const nextTime = this.nextSamp[0];
      if (reqTime <= nextTime) {
        const prevTime = this.prevSamp[0];
        // The force is null while the sensor is not yet tared/ready: that is a gap.
        const nextVal = this.reportCounts ? this.nextSamp[2] : num(this.nextSamp[1]);
        const prevVal = this.reportCounts ? this.prevSamp[2] : num(this.prevSamp[1]);
        return interpolate(nextVal, prevVal, nextTime, prevTime, reqTime);
      }
      if (this.dataPos >= this.cur.length) {
        const msg = this.cursor.pull();
        if (msg === null) return 0;
        this.cur = msg.data;
        this.dataPos = 0;
        continue;
      }
      this.prevSamp = this.nextSamp;
      this.nextSamp = this.cur[this.dataPos++]!;
    }
  }
}

// ---------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------

const DECODERS: Record<string, DecoderSpec> = {
  status: { subscriptionIdParts: 0, parametersMin: 1, parametersMax: 1, create: (ctx, _n, p) => new StatusField(ctx, p) },
  trapq: { subscriptionIdParts: 2, parametersMin: 2, parametersMax: 2, create: (ctx, n, p) => new TrapQ(ctx, n, p) },
  stepq: { subscriptionIdParts: 2, parametersMin: 1, parametersMax: 2, create: (ctx, n, p) => new StepQ(ctx, n, p) },
  stallguard: { subscriptionIdParts: 2, parametersMin: 2, parametersMax: 2, create: (ctx, n, p) => new Stallguard(ctx, n, p) },
  step_phase: { subscriptionIdParts: 0, parametersMin: 1, parametersMax: 2, create: (ctx, n, p) => new StepPhase(ctx, n, p) },
  accelerometer: { subscriptionIdParts: 2, parametersMin: 2, parametersMax: 2, create: (ctx, n, p) => new Accelerometer(ctx, n, p) },
  // Old capture name of the accelerometer handler, kept by motan for old logs.
  adxl345: { subscriptionIdParts: 2, parametersMin: 2, parametersMax: 2, create: (ctx, n, p) => new Accelerometer(ctx, n, p) },
  angle: { subscriptionIdParts: 2, parametersMin: 1, parametersMax: 1, create: (ctx, n, p) => new Angle(ctx, n, p) },
  ldc1612: { subscriptionIdParts: 2, parametersMin: 1, parametersMax: 2, create: (ctx, n, p) => new EddyCurrent(ctx, n, p) },
  loadcell: { subscriptionIdParts: 2, parametersMin: 1, parametersMax: 2, create: (ctx, n, p) => new LoadCell(ctx, n, p) },
};

/** True when `fn` is a raw dataset type (as opposed to an analyzer). */
export function isRawDatasetType(fn: string): boolean {
  return Object.hasOwn(DECODERS, fn);
}

/**
 * Creates the decoder of a raw dataset name (LogManager.setup_dataset), checking the
 * parameter count and that the capture holds the stream it reads.
 */
export function createRawDecoder(ctx: LogContext, name: string): RawDecoder {
  const parts = nameSplit(name);
  const spec = DECODERS[parts[0]!];
  if (!spec) throw new MotanError(`Unknown dataset '${parts[0]}'`);
  const given = parts.length - 1;
  if (given < spec.parametersMin || given > spec.parametersMax) {
    throw new MotanError(`Invalid number of parameters for '${name}'`);
  }
  if (spec.subscriptionIdParts) {
    const subscriptionId = parts.slice(0, spec.subscriptionIdParts).join(':');
    if (!ctx.hasSubscription(subscriptionId)) {
      throw new MotanError(`Dataset '${subscriptionId}' not in capture`);
    }
  }
  return spec.create(ctx, name, parts);
}
