/**
 * Ready-made graph layouts. They replace the `-g "[[...]]"` strings of motan_graph.py:
 * one click gives the usual view of a kind of data, offered only when the capture
 * contains what it needs.
 */
import type { CaptureInfo } from './catalog';
import { newRow, type GraphConfig } from './graph-model';

export interface Preset {
  id: string;
  /** i18n keys. */
  labelKey: string;
  descKey: string;
  available(info: CaptureInfo): boolean;
  build(info: CaptureInfo): GraphConfig;
}

const has = (info: CaptureInfo, id: string): boolean => info.subscriptions.includes(id);
const ofKind = (info: CaptureInfo, kind: string): string[] =>
  info.subscriptions.filter((s) => s.startsWith(`${kind}:`)).map((s) => s.slice(kind.length + 1));

/** Steppers whose commanded position the toolhead kinematics can predict. */
function kinSteppers(info: CaptureInfo): string[] {
  if (!has(info, 'trapq:toolhead') || (info.kinematics !== 'cartesian' && info.kinematics !== 'corexy')) return [];
  return ['stepper_x', 'stepper_y', 'stepper_z'].filter((s) => has(info, `stepq:${s}`));
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'motion',
    labelKey: 'motiondiag.preset.motion',
    descKey: 'motiondiag.presetDesc.motion',
    available: (i) => has(i, 'trapq:toolhead'),
    build: () => ({ rows: [newRow(['trapq(toolhead,velocity)']), newRow(['trapq(toolhead,accel)'])] }),
  },
  {
    // motan's own default graph set.
    id: 'stepper-deviation',
    labelKey: 'motiondiag.preset.stepperDeviation',
    descKey: 'motiondiag.presetDesc.stepperDeviation',
    available: (i) => kinSteppers(i).length > 0,
    build: (i) => ({
      rows: [
        newRow(['trapq(toolhead,velocity)']),
        newRow(['trapq(toolhead,accel)']),
        ...kinSteppers(i)
          .filter((s) => s !== 'stepper_z')
          .map((s) => newRow([`deviation(stepq(${s}),kin(${s}))`])),
      ],
    }),
  },
  {
    id: 'accelerometer',
    labelKey: 'motiondiag.preset.accelerometer',
    descKey: 'motiondiag.presetDesc.accelerometer',
    available: (i) => ofKind(i, 'accelerometer').length > 0,
    build: (i) => {
      const name = ofKind(i, 'accelerometer')[0]!;
      return { rows: ['x', 'y', 'z'].map((a) => newRow([`accelerometer(${name},${a})`])) };
    },
  },
  {
    id: 'accelerometer-filtered',
    labelKey: 'motiondiag.preset.accelerometerFiltered',
    descKey: 'motiondiag.presetDesc.accelerometerFiltered',
    available: (i) => ofKind(i, 'accelerometer').length > 0,
    build: (i) => {
      const name = ofKind(i, 'accelerometer')[0]!;
      // Zero-phase band-pass around the usual printer resonances.
      return {
        rows: ['x', 'y'].map((a) =>
          newRow([`accelerometer(${name},${a})`, `sos(accelerometer(${name},${a}),filtfilt,bandpass,2,20,200)`]),
        ),
      };
    },
  },
  {
    id: 'loadcell',
    labelKey: 'motiondiag.preset.loadcell',
    descKey: 'motiondiag.presetDesc.loadcell',
    available: (i) => ofKind(i, 'loadcell').length > 0,
    build: (i) => {
      const name = ofKind(i, 'loadcell')[0]!;
      return { rows: [newRow([`loadcell(${name})`]), newRow([`loadcell(${name},counts)`])] };
    },
  },
  {
    id: 'stallguard',
    labelKey: 'motiondiag.preset.stallguard',
    descKey: 'motiondiag.presetDesc.stallguard',
    available: (i) => ofKind(i, 'stallguard').length > 0,
    // One dataset per row for each driver, like the other presets: sg_result and cs_actual
    // have different units anyway.
    build: (i) => ({
      rows: ofKind(i, 'stallguard').flatMap((s) => [
        newRow([`stallguard(${s},sg_result)`]),
        newRow([`stallguard(${s},cs_actual)`]),
      ]),
    }),
  },
  {
    id: 'angle-sensor',
    labelKey: 'motiondiag.preset.angle',
    descKey: 'motiondiag.presetDesc.angle',
    available: (i) => ofKind(i, 'angle').length > 0,
    build: (i) => ({ rows: ofKind(i, 'angle').map((a) => newRow([`angle(${a})`])) }),
  },
  {
    id: 'eddy',
    labelKey: 'motiondiag.preset.eddy',
    descKey: 'motiondiag.presetDesc.eddy',
    available: (i) => ofKind(i, 'ldc1612').length > 0,
    build: (i) => {
      const name = ofKind(i, 'ldc1612')[0]!;
      return { rows: [newRow([`ldc1612(${name})`]), newRow([`ldc1612(${name},z)`])] };
    },
  },
  {
    id: 'phase',
    labelKey: 'motiondiag.preset.phase',
    descKey: 'motiondiag.presetDesc.phase',
    available: (i) => Object.keys(i.config).some((k) => k.startsWith('tmc') && has(i, `stepq:${k.split(/\s+/).slice(1).join(' ')}`)),
    build: (i) => {
      const driver = Object.keys(i.config).find((k) => k.startsWith('tmc') && has(i, `stepq:${k.split(/\s+/).slice(1).join(' ')}`))!;
      return { rows: [newRow([`step_phase(${driver})`])] };
    },
  },
];

export function availablePresets(info: CaptureInfo): Preset[] {
  return PRESETS.filter((p) => p.available(info));
}
