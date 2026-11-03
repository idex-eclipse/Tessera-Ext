import { describe, expect, it } from 'vitest';

import { isRunStart, lastRunLines, normalizeLines, parseStLog } from '../parse';

// Console output as Klipper prints it (respond_info → "// " prefix), taken from
// klippain-shaketune v6 sources.
const SHAPER_ALL = [
  'AXES_SHAPER_CALIBRATION AXIS=all',
  '// Shake&Tune version: v6.0.0',
  '// Measuring axis_X...',
  '// X axis frequency profile generation...',
  '// This may take some time (1-3min)',
  '// Detected a square corner velocity of 5.0 and a damping ratio of 0.071. These values will be used to compute the input shaper filter recommendations',
  '// Peaks detected on the graph: 2 @ 45.2, 61.0 Hz (1 above effect threshold)',
  '// Recommended filters:',
  '//     -> For performance: MZV @ 52.3 Hz (with a damping ratio of 0.071)',
  '//     -> For low vibrations: EI @ 61.4 Hz (with a damping ratio of 0.071)',
  '// input shaper graphs created successfully!',
  '// Measuring axis_Y...',
  '// Y axis frequency profile generation...',
  '// Recommended filters:',
  '//     -> Best shaper: ZV @ 40.1 Hz (with a damping ratio of 0.052)',
  '// input shaper graphs created successfully!',
  '// Cleaned up the output folder (only the last 10 results were kept)!',
];

describe('parseStLog', () => {
  it('reads recommendations per axis and finishes the run', () => {
    const r = parseStLog(SHAPER_ALL);
    expect(r.version).toBe('v6.0.0');
    expect(r.kind).toBe('shaper');
    expect(r.running).toBe(false);
    expect(r.graphsCreated).toBe(true);
    expect(r.shaper.X?.recs).toEqual([
      { kind: 'performance', name: 'mzv', freq: 52.3, damping: 0.071 },
      { kind: 'lowVibrations', name: 'ei', freq: 61.4, damping: 0.071 },
    ]);
    expect(r.shaper.X?.scv).toBe(5);
    expect(r.shaper.X?.peaks).toContain('45.2');
    expect(r.shaper.Y?.recs).toEqual([{ kind: 'best', name: 'zv', freq: 40.1, damping: 0.052 }]);
  });

  it('is running between X graphs and the Y measurement', () => {
    expect(parseStLog(SHAPER_ALL.slice(0, 11)).running).toBe(false);
    const mid = parseStLog(SHAPER_ALL.slice(0, 13));
    expect(mid.running).toBe(true);
    expect(mid.progress).toBe('Y axis frequency profile generation...');
  });

  it('parses recommendations without damping (older versions)', () => {
    const r = parseStLog(['// Measuring axis_X...', '//  -> For performance: 2HUMP_EI @ 70.0 Hz']);
    expect(r.shaper.X?.recs[0]).toEqual({ kind: 'performance', name: '2hump_ei', freq: 70, damping: null });
  });

  it('reads belts', () => {
    const r = parseStLog([
      '// Shake&Tune version: v6.0.0',
      '// COREXY kinematics mode',
      '// Measuring belt_A...',
      '// Measuring belt_B...',
      '// Belts comparative frequency profile generation...',
      '// Belts estimated similarity: 93.4%',
      '// Mechanical health: OK',
      '// belts comparison graphs created successfully!',
    ]);
    expect(r.kind).toBe('belts');
    expect(r.belts).toEqual({ similarity: 93.4, health: 'OK' });
    expect(r.running).toBe(false);
  });

  it('reads the vibrations profile with its lists', () => {
    const r = parseStLog([
      '// Shake&Tune version: v6.0.0',
      '// -> Measuring angle: 0 degrees...',
      '// Current speed: 2 mm/s',
      '// Machine vibrations profile generation...',
      '// Machine estimated vibration symmetry: 87.1%',
      '// Vibrations peaks detected: 3 @ 120, 180, 240 mm/s',
      '// Lowest vibrations speeds (3 ranges sorted from best to worse):',
      '// 1: 40.0 to 62.0 mm/s',
      '// 2: 150.0 to 170.0 mm/s',
      '// Lowest vibrations angles (2 ranges sorted from best to worse):',
      '// 1: 30.0° to 50.0° (mean vibrations energy: 12.1% of max)',
      '// Motors have a main resonant frequency at 125.3Hz with an estimated damping ratio of 0.050',
      '// vibrations profile graphs created successfully!',
    ]);
    expect(r.kind).toBe('vibrations');
    expect(r.vibrations).toEqual({
      symmetry: 87.1,
      peaks: '3 @ 120, 180, 240 mm/s',
      speeds: ['40.0 to 62.0 mm/s', '150.0 to 170.0 mm/s'],
      angles: ['30.0° to 50.0° (mean vibrations energy: 12.1% of max)'],
      motor: '125.3Hz with an estimated damping ratio of 0.050',
    });
  });

  it('reads the axes map: correct and mismatching', () => {
    const ok = parseStLog([
      '// Analysis of the movements...',
      '// ==> Detected axes_map: x,y,z',
      '//     Your current axes_map configuration is already correct!',
      '// axes map graphs created successfully!',
    ]);
    expect(ok.axesMap).toEqual({ detected: 'x,y,z', ok: true, suggestion: null });

    const bad = parseStLog([
      '// Analysis of the movements...',
      '// ==> Detected axes_map: -z,y,x',
      "//     Your current axes_map doesn't match! Please update your configuration to -z,y,x.",
    ]);
    expect(bad.axesMap).toEqual({ detected: '-z,y,x', ok: false, suggestion: '-z,y,x' });
  });

  it('reads the excitation', () => {
    const r = parseStLog(['// Excitating X axis at 25.0Hz for 30 seconds']);
    expect(r.kind).toBe('excitate');
    expect(r.excitate).toEqual({ axis: 'x', freq: 25, seconds: 30 });
    expect(r.running).toBe(true);
  });

  it('ends the run on a timeout, an error or a Klipper error', () => {
    const t = parseStLog(['// Measuring axis_X...', '// Timeout: Shake&Tune computation did not finish within the specified timeout!']);
    expect(t.running).toBe(false);
    expect(t.error).toContain('Timeout');

    const k = parseStLog(['AXES_SHAPER_CALIBRATION', '!! Must home axis first: 0.000 0.000 0.000 [0.000]']);
    expect(k.running).toBe(false);
    expect(k.error).toBe('Must home axis first: 0.000 0.000 0.000 [0.000]');
  });
});

describe('run boundaries', () => {
  it('recognizes banners and command echoes, with or without the underscore', () => {
    expect(isRunStart('// Shake&Tune version: v5.1.0')).toBe(true);
    expect(isRunStart('_AXES_SHAPER_CALIBRATION AXIS=x')).toBe(true);
    expect(isRunStart('compare_belts_responses')).toBe(true);
    expect(isRunStart('// Measuring axis_X...')).toBe(false);
    expect(isRunStart('SHAPER_CALIBRATE')).toBe(false);
  });

  it('takes the last run of a console history, from its command echo', () => {
    const history = ['G28', ...SHAPER_ALL, 'M117 hello', 'AXES_MAP_CALIBRATION', '// Shake&Tune version: v6.0.0', '// Analysis of the movements...'];
    expect(lastRunLines(history)).toEqual(['AXES_MAP_CALIBRATION', '// Shake&Tune version: v6.0.0', '// Analysis of the movements...']);
    expect(lastRunLines(['G28', 'M117 x'])).toEqual([]);
  });

  it('splits multi-line notifications', () => {
    expect(normalizeLines(['// a\n// b', '', 42, ' // c '])).toEqual(['// a', '// b', '// c']);
  });
});
