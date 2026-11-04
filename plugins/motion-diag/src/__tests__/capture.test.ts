/**
 * Recording and discovery against a fake Klipper that replays a fixture capture: what the
 * session records must feed the same decoders and give the same numbers as the original.
 */
import { describe, expect, it, vi } from 'vitest';

import { CaptureSession } from '../core/capture';
import { buildSources, discoverSources } from '../core/discovery';
import { generateDatasets } from '../core/engine';
import type { CaptureData, StatusTree } from '../core/types';
import { fakeKlipper, fixture, flush } from './helpers/fake-klipper';

describe('buildSources', () => {
  const sources = buildSources(fixture.initialStatus);
  const ids = sources.map((s) => s.id);

  it('lists trapq, stepq and then the config based streams in config order, like motan', () => {
    expect(ids).toEqual([
      'trapq:toolhead',
      'stepq:stepper_x',
      'stepq:stepper_y',
      'stepq:stepper_z',
      // the fixture's config lists the drivers first
      'stallguard:stepper_x',
      'stallguard:stepper_y',
      'accelerometer:hotend',
      'angle:ang_x',
      'angle:ang_z',
      'ldc1612:eddy',
      'loadcell:lc',
    ]);
  });

  it('records trapq and stepq by default, like motan', () => {
    expect(sources.filter((s) => s.byDefault).map((s) => s.id)).toEqual([
      'trapq:toolhead',
      'stepq:stepper_x',
      'stepq:stepper_y',
      'stepq:stepper_z',
    ]);
  });

  it('maps every kind to its Klipper endpoint and parameter name', () => {
    const by = Object.fromEntries(sources.map((s) => [s.id, s]));
    expect(by['trapq:toolhead']).toMatchObject({ method: 'motion_report/dump_trapq', paramVariants: [{ name: 'toolhead' }] });
    expect(by['stepq:stepper_x']).toMatchObject({ method: 'motion_report/dump_stepper', paramVariants: [{ name: 'stepper_x' }] });
    expect(by['accelerometer:hotend']).toMatchObject({ method: 'adxl345/dump_adxl345', paramVariants: [{ sensor: 'hotend' }] });
    expect(by['angle:ang_x']).toMatchObject({ method: 'angle/dump_angle', paramVariants: [{ sensor: 'ang_x' }] });
    expect(by['ldc1612:eddy']).toMatchObject({ method: 'ldc1612/dump_ldc1612', paramVariants: [{ sensor: 'eddy' }] });
    expect(by['stallguard:stepper_x']).toMatchObject({ method: 'tmc/stallguard_dump', paramVariants: [{ name: 'stepper_x' }] });
    // The load cell key differs between Klipper versions: both are offered.
    expect(by['loadcell:lc']).toMatchObject({
      method: 'load_cell/dump_force',
      paramVariants: [{ load_cell: 'lc' }, { sensor: 'lc' }],
    });
  });

  it('serves lis3dh by the lis2dw endpoint and names an unnamed section after its type', () => {
    const status: StatusTree = {
      configfile: { settings: { lis3dh: { cs_pin: 'x' }, 'lis2dw bed': {}, 'mpu9250 head': {} } },
      motion_report: { trapq: [], steppers: [] },
    };
    const found = buildSources(status);
    expect(found.map((s) => [s.id, s.method])).toEqual([
      ['accelerometer:lis3dh', 'lis2dw/dump_lis2dw'],
      ['accelerometer:bed', 'lis2dw/dump_lis2dw'],
      ['accelerometer:head', 'mpu9250/dump_mpu9250'],
    ]);
  });

  it('ignores config sections that are not streamable', () => {
    expect(buildSources({ configfile: { settings: { printer: {}, 'heater_bed': {} } } })).toEqual([]);
  });
});

describe('discoverSources', () => {
  it('reads motion_report and the config over the bridge', async () => {
    const klippyRequest = vi.fn(async (method: string) =>
      method === 'info' ? { state: 'ready' } : { status: fixture.initialStatus },
    );
    const found = await discoverSources({ klippyRequest });
    expect(found.map((s) => s.id)).toContain('accelerometer:hotend');
    expect(klippyRequest).toHaveBeenCalledWith('objects/query', { objects: { configfile: ['settings'], motion_report: null } });
  });

  it('refuses when Klipper is not ready', async () => {
    const klippyRequest = vi.fn(async () => ({ state: 'shutdown' }));
    await expect(discoverSources({ klippyRequest })).rejects.toThrow(/not ready \(shutdown\)/);
  });
});

describe('CaptureSession', () => {
  it('follows data_logger: info, objects/list, status of every object, then the streams', async () => {
    const k = fakeKlipper();
    const chosen = k.sources.filter((s) => ['trapq:toolhead', 'accelerometer:hotend', 'loadcell:lc'].includes(s.id));
    const session = new CaptureSession(k.handle, chosen);
    await session.start();

    expect(k.handle.klippyRequest.mock.calls.map((c) => c[0])).toEqual(['info', 'objects/list']);
    expect(k.subs[0]!.method).toBe('objects/subscribe');
    expect(Object.keys((k.subs[0]!.params as { objects: object }).objects)).toEqual(Object.keys(fixture.initialStatus));
    expect(k.subs.slice(1).map((s) => [s.method, s.params])).toEqual([
      ['motion_report/dump_trapq', { name: 'toolhead' }],
      ['adxl345/dump_adxl345', { sensor: 'hotend' }],
      ['load_cell/dump_force', { load_cell: 'lc' }],
    ]);
    expect(session.snapshot().state).toBe('recording');
  });

  it('records what the decoders then read, with the same numbers as the original capture', async () => {
    const k = fakeKlipper();
    const chosen = k.sources.filter((s) => ['trapq:toolhead', 'accelerometer:hotend'].includes(s.id));
    const session = new CaptureSession(k.handle, chosen);
    await session.start();
    await flush();
    k.replay();
    const recorded = session.stop() as CaptureData;

    expect([...recorded.subscriptions].sort()).toEqual(['accelerometer:hotend', 'trapq:toolhead']);
    const columns = ['trapq(toolhead,velocity)', 'accelerometer(hotend,x)', 'derivative(trapq(toolhead,x))'];
    const opts = { segmentTime: 0.002, skip: 0, duration: 1.5 };
    const a = await generateDatasets(recorded, columns, opts);
    const b = await generateDatasets(fixture, columns, opts);
    for (const c of columns) expect(Array.from(a.series.get(c)!)).toEqual(Array.from(b.series.get(c)!));
    expect(session.snapshot().state).toBe('stopped');
    expect(session.snapshot().sources.map((s) => s.messages)).toEqual([
      fixture.streams.get('trapq:toolhead')!.length,
      fixture.streams.get('accelerometer:hotend')!.length,
    ]);
  });

  it('falls back to the other parameter name when Klipper rejects the first', async () => {
    const k = fakeKlipper({ rejectKeys: ['load_cell'] });
    const chosen = k.sources.filter((s) => s.id === 'loadcell:lc');
    const session = new CaptureSession(k.handle, chosen);
    await session.start();
    await flush();
    expect(k.subs.slice(1).map((s) => s.params)).toEqual([{ load_cell: 'lc' }, { sensor: 'lc' }]);
    expect(session.snapshot().sources[0]!.status).toBe('live');
    k.replay();
    expect(session.stop()!.subscriptions.has('loadcell:lc')).toBe(true);
  });

  it('keeps an unacknowledged stream out of the capture and reports it unavailable', async () => {
    const k = fakeKlipper({ rejectKeys: ['sensor', 'load_cell'] });
    const chosen = k.sources.filter((s) => s.id === 'loadcell:lc');
    const session = new CaptureSession(k.handle, chosen);
    // The status subscription carries no rejected key, so the session still starts.
    await session.start();
    await flush();
    expect(session.snapshot().sources[0]!.status).toBe('unavailable');
    expect(session.stop()!.subscriptions.has('loadcell:lc')).toBe(false);
  });

  it('fails when Klipper is not ready, without opening any stream', async () => {
    const k = fakeKlipper({ state: 'startup' });
    const session = new CaptureSession(k.handle, k.sources.slice(0, 1));
    await expect(session.start()).rejects.toThrow(/not ready/);
    expect(session.snapshot()).toMatchObject({ state: 'failed', reason: expect.stringMatching(/not ready/) });
    expect(k.handle.klippyStream).not.toHaveBeenCalled();
  });

  it('stops by itself at the time limit and keeps the data recorded so far', async () => {
    const k = fakeKlipper();
    const onChange = vi.fn();
    const session = new CaptureSession(k.handle, k.sources.filter((s) => s.id === 'trapq:toolhead'), {
      limits: { maxSeconds: 1 },
      onChange,
    });
    await session.start();
    await flush();
    // Status updates carry the printer clock: 100 s at the start, so 101 s ends it.
    k.subs[0]!.onData({ status: { toolhead: { estimated_print_time: 100.5 } } });
    expect(session.snapshot().state).toBe('recording');
    k.subs[0]!.onData({ status: { toolhead: { estimated_print_time: 101.2 } } });
    expect(session.snapshot()).toMatchObject({ state: 'stopped', reason: expect.stringMatching(/time limit/) });
    expect(session.getCapture()).not.toBeNull();
    expect(k.subs.every((s) => s.cancelled)).toBe(true);
  });

  it('stops at the memory limit', async () => {
    const k = fakeKlipper();
    const session = new CaptureSession(k.handle, k.sources.filter((s) => s.id === 'accelerometer:hotend'), {
      limits: { maxBytes: 10_000 },
    });
    await session.start();
    await flush();
    const rows = Array.from({ length: 100 }, (_, i) => [100 + i / 1000, 1, 2, 3]);
    k.subs[1]!.onData({ data: rows });
    expect(session.snapshot()).toMatchObject({ state: 'stopped', reason: expect.stringMatching(/memory/) });
  });

  it('fails, keeping partial data, when the bridge drops during the recording', async () => {
    const k = fakeKlipper();
    const session = new CaptureSession(k.handle, k.sources.filter((s) => s.id === 'trapq:toolhead'));
    await session.start();
    await flush();
    k.subs[1]!.onData({ data: [[100.2, 0.1, 0, 0, [0, 0, 0], [1, 0, 0]]] });
    k.subs[0]!.onStatus!('unavailable');
    expect(session.snapshot()).toMatchObject({ state: 'failed', reason: expect.stringMatching(/lost/) });
    expect(session.getCapture()!.streams.get('trapq:toolhead')).toHaveLength(1);
  });

  it('stop() is safe at any time and releases every subscription', async () => {
    const k = fakeKlipper();
    const session = new CaptureSession(k.handle, k.sources.slice(0, 2));
    expect(session.stop()).toBeNull();
    await session.start();
    session.stop();
    session.stop();
    expect(k.subs.every((s) => s.cancelled)).toBe(true);
  });

  it('refuses an empty selection and a second start', async () => {
    const k = fakeKlipper();
    await expect(new CaptureSession(k.handle, []).start()).rejects.toThrow(/at least one/);
    const session = new CaptureSession(k.handle, k.sources.slice(0, 1));
    await session.start();
    await expect(session.start()).rejects.toThrow(/already/);
  });
});
