/**
 * What can be recorded on this printer: a port of `build_subscriptions` and the
 * `ConfigSubscriptions` table of Klipper's data_logger.py.
 *
 * motan asks for glob patterns (`-s "accelerometer:*"`); here the same information is a
 * list of sources the UI shows as checkboxes.
 */
import type { MoonrakerProxyHandle } from '../sdk';
import { MotanError, type StatusTree } from './types';

export type SourceKind = 'trapq' | 'stepq' | 'accelerometer' | 'angle' | 'ldc1612' | 'loadcell' | 'stallguard';

/** One Klipper bulk stream that can be recorded. */
export interface DataSource {
  /** Subscription id used in the capture and in dataset names, e.g. `accelerometer:hotend`. */
  id: string;
  kind: SourceKind;
  /** Object name within the kind, e.g. `hotend`, `stepper_x`, `toolhead`. */
  name: string;
  /** The Klipper config section it comes from (`adxl345 hotend`); empty for motion_report streams. */
  section: string;
  /** Klipper webhooks method of the stream. */
  method: string;
  /**
   * Parameter sets to try in turn. Klipper versions disagree on the key that names the
   * sensor for some streams (`sensor` in the documentation, `load_cell` in some code), and
   * a rejected subscription is the only way to find out.
   */
  paramVariants: ReadonlyArray<Record<string, string>>;
  /** Recorded by default (motan's default: every trapq and stepq). */
  byDefault: boolean;
}

interface ConfigRule {
  kind: SourceKind;
  /** Capture name prefix; the subscription id is `<prefix>:<name>`. */
  prefix: string;
  method: (configType: string) => string;
  paramKeys: readonly string[];
}

const ACCEL = (ct: string): string => `${ct}/dump_${ct}`;
const accelRule: ConfigRule = { kind: 'accelerometer', prefix: 'accelerometer', method: ACCEL, paramKeys: ['sensor'] };
const stallRule: ConfigRule = { kind: 'stallguard', prefix: 'stallguard', method: () => 'tmc/stallguard_dump', paramKeys: ['name'] };
const loadCellRule: ConfigRule = {
  kind: 'loadcell',
  prefix: 'loadcell',
  method: () => 'load_cell/dump_force',
  // data_logger.py uses `load_cell`; Klipper's API documentation says `sensor`.
  paramKeys: ['load_cell', 'sensor'],
};

/** Config section type -> how to stream it (data_logger.ConfigSubscriptions). */
const CONFIG_RULES: Readonly<Record<string, ConfigRule>> = {
  adxl345: accelRule,
  lis2dw: accelRule,
  // lis3dh is served by the lis2dw endpoint.
  lis3dh: { ...accelRule, method: () => 'lis2dw/dump_lis2dw' },
  mpu9250: accelRule,
  bmi160: accelRule,
  icm20948: accelRule,
  angle: { kind: 'angle', prefix: 'angle', method: () => 'angle/dump_angle', paramKeys: ['sensor'] },
  probe_eddy_current: { kind: 'ldc1612', prefix: 'ldc1612', method: () => 'ldc1612/dump_ldc1612', paramKeys: ['sensor'] },
  load_cell: loadCellRule,
  load_cell_probe: loadCellRule,
  tmc2130: stallRule,
  tmc2209: stallRule,
  tmc2260: stallRule,
  tmc2240: stallRule,
  tmc5160: stallRule,
  tmc5262: stallRule,
};

/**
 * Sources available given the printer status (`motion_report` and `configfile`).
 * Order: trapq, stepq, then the config-based ones in config order, like motan.
 */
export function buildSources(status: StatusTree): DataSource[] {
  const out: DataSource[] = [];
  const motion = status.motion_report ?? {};
  for (const trapq of (Array.isArray(motion.trapq) ? motion.trapq : []) as string[]) {
    out.push({
      id: `trapq:${trapq}`,
      kind: 'trapq',
      name: trapq,
      section: '',
      method: 'motion_report/dump_trapq',
      paramVariants: [{ name: trapq }],
      byDefault: true,
    });
  }
  for (const stepper of (Array.isArray(motion.steppers) ? motion.steppers : []) as string[]) {
    out.push({
      id: `stepq:${stepper}`,
      kind: 'stepq',
      name: stepper,
      section: '',
      method: 'motion_report/dump_stepper',
      paramVariants: [{ name: stepper }],
      byDefault: true,
    });
  }
  const settings = (status.configfile?.settings ?? {}) as Record<string, unknown>;
  for (const section of Object.keys(settings)) {
    const parts = section.split(/\s+/).filter(Boolean);
    const configType = parts[0];
    if (!configType || !Object.hasOwn(CONFIG_RULES, configType)) continue;
    const rule = CONFIG_RULES[configType]!;
    // `[adxl345]` has no name; motan then uses the section type itself.
    const name = parts.length > 1 ? parts.slice(1).join(' ') : parts[parts.length - 1]!;
    out.push({
      id: `${rule.prefix}:${name}`,
      kind: rule.kind,
      name,
      section,
      method: rule.method(configType),
      paramVariants: rule.paramKeys.map((key) => ({ [key]: name })),
      byDefault: false,
    });
  }
  return out;
}

/**
 * Asks Klipper (over the Klippy bridge) what it has and returns the recordable sources.
 * Rejects with a MotanError when Klipper is not ready.
 */
export async function discoverSources(handle: Pick<MoonrakerProxyHandle, 'klippyRequest'>): Promise<DataSource[]> {
  const info = (await handle.klippyRequest('info')) as { state?: string; state_message?: string };
  if (info.state !== 'ready') {
    throw new MotanError(`Klipper is not ready (${info.state ?? 'unknown state'})`);
  }
  const res = (await handle.klippyRequest('objects/query', {
    objects: { configfile: ['settings'], motion_report: null },
  })) as { status?: StatusTree };
  return buildSources(res.status ?? {});
}
