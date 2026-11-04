import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import { generateDatasets } from '../core/engine';
import { dataset, nameSplit, paramSplit, plainArg } from '../core/names';
import { pyFixed, pyMod, pyRound } from '../core/py';
import { MotanError, type CaptureData } from '../core/types';
import { loadMotanLog } from './helpers/motan-log';

const cartesian = loadMotanLog(fileURLToPath(new URL('./fixtures/cartesian/log', import.meta.url)));
const OPTS = { segmentTime: 0.002, skip: 0, duration: 0.5 };

const labelOf = async (name: string, capture: CaptureData = cartesian) =>
  (await generateDatasets(capture, [name], OPTS)).labels.get(name)!;

describe('dataset names', () => {
  it('splits parameters outside parentheses only', () => {
    expect(paramSplit('a,b(c,d),e')).toEqual(['a', 'b(c,d)', 'e']);
    expect(nameSplit('deviation(stepq(stepper_x),kin(stepper_x))')).toEqual([
      'deviation',
      'stepq(stepper_x)',
      'kin(stepper_x)',
    ]);
  });

  it('builds names the parser reads back', () => {
    const inner = dataset('stepq', 'stepper_x', 0.02);
    expect(dataset('deviation', inner, dataset('kin', 'stepper_x'))).toBe('deviation(stepq(stepper_x,0.02),kin(stepper_x))');
    expect(nameSplit(inner)).toEqual(['stepq', 'stepper_x', '0.02']);
  });

  it('refuses names that would break the notation', () => {
    expect(() => nameSplit('stepq')).toThrow(MotanError);
    expect(plainArg('stepper_x', 'Stepper')).toBe('stepper_x');
    expect(() => plainArg('a,b', 'Sensor')).toThrow(/cannot be used/);
    expect(() => plainArg('', 'Sensor')).toThrow(/cannot be used/);
  });
});

describe('Python semantics', () => {
  it('rounds halves to even like Python', () => {
    expect([0.5, 1.5, 2.5, 3.5, -0.5, -1.5, 2.4, 2.6].map(pyRound)).toEqual([0, 2, 2, 4, 0, -2, 2, 3]);
  });

  it('keeps the modulo non-negative', () => {
    expect(pyMod(-1, 64)).toBe(63);
    expect(pyMod(65, 64)).toBe(1);
  });

  it('formats ties to even', () => {
    expect(pyFixed(2.5, 0)).toBe('2');
    expect(pyFixed(3.5, 0)).toBe('4');
    expect(pyFixed(60, 0)).toBe('60');
    expect(pyFixed(30, 1)).toBe('30.0');
  });
});

describe('labels and units (as motan names them)', () => {
  it('renames units through derivative and integral', async () => {
    expect(await labelOf('derivative(trapq(toolhead,x))')).toEqual({ label: 'toolhead x velocity', units: 'Velocity\n(mm/s)' });
    expect(await labelOf('derivative(trapq(toolhead,x_velocity))')).toEqual({
      label: 'toolhead x acceleration',
      units: 'Acceleration\n(mm/s^2)',
    });
    expect(await labelOf('integral(trapq(toolhead,accel))')).toEqual({ label: 'toolhead velocity', units: 'Velocity\n(mm/s)' });
    expect(await labelOf('derivative(loadcell(lc))')).toEqual({ label: 'Derivative of lc force', units: 'Unknown' });
  });

  it('names a norm2 after its parts', async () => {
    expect((await labelOf('norm2(trapq(toolhead,x_velocity),trapq(toolhead,y_velocity))')).label).toBe(
      'toolhead x+toolhead y velocity norm2',
    );
  });

  it('inserts "Deviation" into the units, or gives up when the units differ', async () => {
    expect(await labelOf('deviation(trapq(toolhead,x),trapq(toolhead,y))')).toEqual({
      label: 'toolhead x position deviation',
      units: 'Position\nDeviation\n(mm)',
    });
    expect(await labelOf('deviation(trapq(toolhead,x),trapq(toolhead,velocity))')).toEqual({ label: 'Deviation', units: 'Unknown' });
  });

  it('describes sos filters', async () => {
    expect((await labelOf('sos(accelerometer(hotend,x),filt,lowpass,2,60)')).label).toBe(
      'SOS lowpass 60Hz order 2 (hotend x acceleration)',
    );
    expect((await labelOf('sos(accelerometer(hotend,x),filt,bandpass,2,30,100)')).label).toBe(
      'SOS bandpass 30.0..100.0Hz order 2 (hotend x acceleration)',
    );
    expect((await labelOf('sos(accelerometer(hotend,x),filt,notch,55,10)')).label).toBe(
      'SOS notch 55.0Hz Q: 10.0 (hotend x acceleration)',
    );
  });
});

describe('errors', () => {
  const fails = (name: string, message: RegExp, capture: CaptureData = cartesian) =>
    expect(generateDatasets(capture, [name], OPTS)).rejects.toThrow(message);

  it('reports unknown datasets and wrong parameter counts', async () => {
    await fails('nothing(x)', /Unknown dataset 'nothing\(x\)'/);
    await fails('trapq(toolhead)', /Invalid number of parameters/);
    await fails('deviation(trapq(toolhead,x))', /Invalid parameters to dataset/);
    await fails('trapq(toolhead,w)', /Unknown trapq data selection/);
    await fails('accelerometer(hotend,q)', /Unknown accelerometer/);
    await fails('stepq(stepper_x,abc)', /Invalid stepq smooth time/);
    await fails('ldc1612(eddy,speed)', /Unknown ldc1612 selection/);
    await fails('loadcell(lc,force)', /Unknown loadcell selection/);
    await fails('step_phase(tmc2209 stepper_x,phase)', /Unknown step_phase selection/);
    await fails('sos(accelerometer(hotend,x),maybe,lowpass,2,60)', /Unknown sos type/);
    await fails('sos(accelerometer(hotend,x),filt,sideways,2,60)', /Unknown filter type/);
    await fails('malformed', /Malformed dataset name/);
  });

  it('reports a stream the capture does not contain', async () => {
    await fails('accelerometer(missing,x)', /'accelerometer:missing' not in capture/);
    await fails('step_phase(tmc2209 stepper_z)', /Unable to find stepper driver/);
  });

  it('reports unsupported kinematics and steppers', async () => {
    const delta: CaptureData = {
      ...cartesian,
      initialStatus: {
        ...cartesian.initialStatus,
        configfile: { settings: { ...(cartesian.initialStatus.configfile!.settings as object), printer: { kinematics: 'delta' } } },
      },
    };
    await fails('kin(stepper_x)', /Unsupported kinematics 'delta'/, delta);
    await fails('kin(extruder)', /Unknown stepper 'extruder'/);
  });

  it('refuses a filter that cannot work at the sampling rate', async () => {
    await fails('sos(accelerometer(hotend,x),filt,lowpass,2,300)', /fs\/2/);
  });

  it('refuses a non-positive grid', async () => {
    await expect(generateDatasets(cartesian, [], { ...OPTS, segmentTime: 0 })).rejects.toThrow(/time step/);
    await expect(generateDatasets(cartesian, [], { ...OPTS, duration: -1 })).rejects.toThrow(/duration/);
  });
});

describe('generation', () => {
  it('gives every column the same length as the time axis, starting one step after the window start', async () => {
    const out = await generateDatasets(cartesian, ['trapq(toolhead,x)', 'derivative(trapq(toolhead,x))'], OPTS);
    // The grid is accumulated like motan's, so float error can add one step to 0.5 s / 2 ms.
    expect(out.times.length).toBeGreaterThanOrEqual(250);
    expect(out.times.length).toBeLessThanOrEqual(251);
    expect(out.times[0]).toBeCloseTo(0.002, 12);
    for (const s of out.series.values()) expect(s.length).toBe(out.times.length);
  });

  it('shares work between datasets that need the same source', async () => {
    const a = await generateDatasets(cartesian, ['deviation(stepq(stepper_x),kin(stepper_x))'], OPTS);
    const b = await generateDatasets(cartesian, ['stepq(stepper_x)', 'kin(stepper_x)'], OPTS);
    const dev = a.series.get('deviation(stepq(stepper_x),kin(stepper_x))')!;
    const x = b.series.get('stepq(stepper_x)')!;
    const k = b.series.get('kin(stepper_x)')!;
    for (let i = 0; i < dev.length; i++) expect(dev[i]).toBe(x[i]! - k[i]!);
  });

  it('yields between chunks and reports progress', async () => {
    const onProgress = vi.fn();
    await generateDatasets(cartesian, ['trapq(toolhead,x)'], { ...OPTS, chunk: 50, onProgress });
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(onProgress).toHaveBeenLastCalledWith(1);
  });

  it('can be aborted between chunks', async () => {
    const ctl = new AbortController();
    const promise = generateDatasets(cartesian, ['trapq(toolhead,x)'], {
      ...OPTS,
      chunk: 20,
      signal: ctl.signal,
      onProgress: () => ctl.abort(),
    });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('trims spaces around a dataset name like motan', async () => {
    const out = await generateDatasets(cartesian, [' trapq(toolhead,x) '], OPTS);
    expect(out.series.get(' trapq(toolhead,x) ')!.length).toBe(out.times.length);
  });
});
