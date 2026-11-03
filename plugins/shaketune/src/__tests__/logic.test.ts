import { afterEach, describe, expect, it } from 'vitest';

import { accelChips, buildCommand, commandDef, scriptCommands } from '../commands';
import { configFromSettings } from '../printer-config';
import { graphAxis, isGraph, listResults, resolveResultsPath } from '../results';
import { _resetAll, appendLines, beginRun, endRun, getState, restoreFromHistory, setFiles } from '../run-store';
import { applyCommand, configSnippet } from '../ui/result-cards';
import { parseStLog } from '../parse';
import type { MoonrakerProxyHandle } from '../sdk';

describe('commands', () => {
  it('sends only filled, valid parameters', () => {
    const def = commandDef('shaper');
    expect(buildCommand(def, {})).toEqual({ script: 'AXES_SHAPER_CALIBRATION', invalid: [] });
    expect(buildCommand(def, { AXIS: 'x', FREQ_START: ' 10 ', MAX_SCALE: '' }).script).toBe(
      'AXES_SHAPER_CALIBRATION AXIS=x FREQ_START=10',
    );
    expect(buildCommand(def, { AXIS: 'z', FREQ_START: '0', MAX_SCALE: '1.5', HZ_PER_SEC: 'abc' }).invalid).toEqual([
      'AXIS', 'FREQ_START', 'HZ_PER_SEC', 'MAX_SCALE',
    ]);
  });

  it('quotes accelerometer names with a space', () => {
    expect(buildCommand(commandDef('belts'), { ACCEL_CHIP: 'adxl345 bed' }).script).toBe(
      'COMPARE_BELTS_RESPONSES ACCEL_CHIP="adxl345 bed"',
    );
    expect(buildCommand(commandDef('belts'), { ACCEL_CHIP: 'a"b' }).invalid).toEqual(['ACCEL_CHIP']);
  });

  it('finds accelerometer sections and script commands', () => {
    expect(accelChips(['printer', 'adxl345', 'adxl345 bed', 'lis2dw', 'adxl345x', 'resonance_tester'])).toEqual([
      'adxl345', 'adxl345 bed', 'lis2dw',
    ]);
    expect(scriptCommands('G28\n; comment\n  axes_shaper_calibration AXIS=x')).toEqual(['G28', 'AXES_SHAPER_CALIBRATION']);
  });
});

describe('printer config and results', () => {
  it('maps result_folder onto the config root', () => {
    expect(resolveResultsPath(null)).toBe('ShakeTune_results');
    expect(resolveResultsPath('~/printer_data/config/ShakeTune_results/')).toBe('ShakeTune_results');
    expect(resolveResultsPath('/home/pi/printer_data/config/st/res')).toBe('st/res');
    expect(resolveResultsPath('/home/pi/klipper_config/ShakeTune_results')).toBe('ShakeTune_results');
    expect(resolveResultsPath('/tmp/shaketune')).toBeNull();
  });

  it('reads what the plugin needs from configfile.settings', () => {
    expect(
      configFromSettings({
        printer: { kinematics: 'CoreXY' },
        shaketune: { result_folder: '~/printer_data/config/K-ST' },
        'adxl345 bed': {},
      }),
    ).toEqual({ hasShakeTune: true, resultsPath: 'K-ST', kinematics: 'corexy', chips: ['adxl345 bed'] });
    expect(configFromSettings({}).hasShakeTune).toBe(false);
  });

  it('lists only finished graphs, newest first, ignoring missing folders', async () => {
    const dirs: Record<string, Array<{ filename: string; modified: number }>> = {
      'config/ShakeTune_results/input_shaper': [
        { filename: 'inputshaper_20260101_100000_axis_X.png', modified: 10 },
        { filename: 'inputshaper_20260101_100000_axis_X.stdata', modified: 10 },
        { filename: 'snt_tmp-1a2b3c4d.png', modified: 30 },
      ],
      'config/ShakeTune_results/belts': [{ filename: 'beltscomparison_20260102_100000.png', modified: 20 }],
    };
    const handle = {
      request: async (_m: string, p: { path: string }) => {
        const files = dirs[p.path];
        if (!files) throw new Error('404');
        return { files };
      },
    } as unknown as MoonrakerProxyHandle;
    const files = await listResults(handle, 'ShakeTune_results');
    expect(files.map((f) => [f.folder, f.name, f.axis])).toEqual([
      ['belts', 'beltscomparison_20260102_100000.png', null],
      ['input_shaper', 'inputshaper_20260101_100000_axis_X.png', 'X'],
    ]);
    expect(isGraph('x.PNG')).toBe(true);
    expect(graphAxis('inputshaper_1_axis_y.png')).toBe('Y');
  });
});

describe('apply and snippet', () => {
  const result = parseStLog([
    '// Measuring axis_X...',
    '// -> For performance: MZV @ 52.3 Hz (with a damping ratio of 0.071)',
    '// -> For low vibrations: EI @ 61.4 Hz (with a damping ratio of 0.071)',
    '// Measuring axis_Y...',
    '// -> Best shaper: ZV @ 40.1 Hz',
  ]);

  it('uses SHAPER_FREQ_* and the picked recommendation', () => {
    expect(applyCommand(result, {}, false)).toBe(
      'SET_INPUT_SHAPER SHAPER_TYPE_X=mzv SHAPER_FREQ_X=52.3 SHAPER_TYPE_Y=zv SHAPER_FREQ_Y=40.1',
    );
    expect(applyCommand(result, { X: 'lowVibrations' }, true)).toBe(
      'SET_INPUT_SHAPER SHAPER_TYPE_X=ei SHAPER_FREQ_X=61.4 DAMPING_RATIO_X=0.071 SHAPER_TYPE_Y=zv SHAPER_FREQ_Y=40.1',
    );
    expect(applyCommand(parseStLog([]), {}, false)).toBeNull();
  });

  it('builds the printer.cfg block', () => {
    expect(configSnippet(result, {}, true)).toBe(
      '[input_shaper]\nshaper_type_x: mzv\nshaper_freq_x: 52.3\ndamping_ratio_x: 0.071\nshaper_type_y: zv\nshaper_freq_y: 40.1',
    );
  });
});

describe('run store', () => {
  afterEach(() => _resetAll());

  it('collects console lines only during a run and detects external runs', () => {
    appendLines('p', ['// some unrelated line']);
    expect(getState('p').lines).toEqual([]);

    appendLines('p', ['// Shake&Tune version: v6.0.0', '// Measuring axis_X...']);
    expect(getState('p').external).toBe(true);
    expect(getState('p').result.running).toBe(true);

    appendLines('p', ['// input shaper graphs created successfully!', '// unrelated after the end']);
    const s = getState('p');
    expect(s.external).toBe(false);
    expect(s.result.running).toBe(false);
    expect(s.lines).not.toContain('// unrelated after the end');
  });

  it('keeps our own run running until the request ends and marks new graphs', () => {
    setFiles('p', [{ path: 'r/belts/a.png', folder: 'belts', name: 'a.png', modified: 1, axis: null }]);
    beginRun('p');
    appendLines('p', ['// Shake&Tune version: v6.0.0', '// belts comparison graphs created successfully!']);
    expect(getState('p').result.running).toBe(true);
    endRun('p');
    expect(getState('p').busy).toBe(false);
    expect(getState('p').result.running).toBe(false);

    setFiles('p', [
      { path: 'r/belts/b.png', folder: 'belts', name: 'b.png', modified: 5, axis: null },
      { path: 'r/belts/a.png', folder: 'belts', name: 'a.png', modified: 1, axis: null },
    ]);
    expect(getState('p').fresh).toEqual(['r/belts/b.png']);
  });

  it('adds the request error to the log', () => {
    beginRun('p');
    endRun('p', 'Must home axis first');
    expect(getState('p').result.error).toBe('Must home axis first');
  });

  it('restores a running external run from the console history, but not a stale one', () => {
    const entries = [
      { message: 'AXES_SHAPER_CALIBRATION', time: 1000, type: 'command' },
      { message: '// Shake&Tune version: v6.0.0', time: 1001 },
      { message: '// Measuring axis_X...', time: 1002 },
    ];
    restoreFromHistory('p', entries, 1100);
    expect(getState('p').external).toBe(true);
    expect(getState('p').result.running).toBe(true);

    restoreFromHistory('q', entries, 1002 + 3600);
    expect(getState('q').result.running).toBe(false);
    expect(getState('q').lines).toHaveLength(3);
  });
});
