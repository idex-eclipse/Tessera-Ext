import { describe, expect, it } from 'vitest';

import { isRunStart, lastRunLines, normalizeLines, parsePaLog } from '../parse';

const STEP = [
  'TEST_PRESSURE_ADVANCE METHOD=step_response',
  '// Detected extrude_force_sign=1',
  '// PA calibration results:',
  '//   flow= 2.00  pressure_advance=0.041',
  '//   flow= 8.00  pressure_advance=0.043',
  '//   overall pressure_advance=0.042',
];

const SEARCH = [
  'PA_CALIBRATE METHOD=search_overshoot PA_RANGE=0,0.2',
  '// Searching for optimal pressure_advance...',
  '// Test 1: pressure_advance=0.1000 ...',
  '// Tested pressure_advance=0.1000 -> overshoot',
  '// Tested pressure_advance=0.0500 -> no overshoot',
  '// Search complete: 2 tests, pressure_advance=0.0620',
  '// PA correction: pressure_advance=0.0580',
  '// (accounts for force data filtering)',
];

describe('normalizeLines', () => {
  it('splits, trims and drops empty lines and non-strings', () => {
    expect(normalizeLines(['// a\n  // b  \n\n', 5, '// c'])).toEqual(['// a', '// b', '// c']);
    expect(normalizeLines('x\r\ny')).toEqual(['x', 'y']);
  });
});

describe('parsePaLog', () => {
  it('reads step_response: per flow and overall, run ends on overall', () => {
    const r = parsePaLog(STEP.slice(0, 4));
    expect(r.running).toBe(true);
    expect(r.method).toBe('step_response');
    expect(r.forceSign).toBe(1);
    expect(r.perFlow).toEqual([{ flow: 2, pa: 0.041 }]);

    const done = parsePaLog(STEP);
    expect(done.running).toBe(false);
    expect(done.perFlow).toHaveLength(2);
    expect(done.overall).toBe(0.042);
    expect(done.value).toBe(0.042);
  });

  it('reads search_overshoot: steps, found and the corrected value wins', () => {
    const r = parsePaLog(SEARCH);
    expect(r.method).toBe('search_overshoot');
    expect(r.search).toEqual([
      { pa: 0.1, overshoot: true },
      { pa: 0.05, overshoot: false },
    ]);
    expect(r.found).toBe(0.062);
    expect(r.corrected).toBe(0.058);
    expect(r.value).toBe(0.058);
    expect(r.running).toBe(false);
  });

  it('without a correction the found value is the result', () => {
    expect(parsePaLog(SEARCH.slice(0, 6)).value).toBe(0.062);
  });

  it('collects warnings and ends the run on failure lines', () => {
    const r = parsePaLog([
      'TEST_PRESSURE_ADVANCE',
      '// WARNING: high_flow is less than 2x slow_flow, PA estimation may be unreliable',
      '// PA calibration results:',
      '// Failed to detect Pressure Advance value.',
      '// Check sensor and filament and try again.',
      '// WARNING: detected PA is very low (0.001). This may indicate an issue with the sensor.',
    ]);
    expect(r.running).toBe(false);
    expect(r.error).toContain('Failed to detect');
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toMatch(/^high_flow is less/);
  });

  it('a "!!" line is an error and ends the run; a new command clears it', () => {
    const failed = parsePaLog(['PA_CALIBRATE', '!! Extruder cannot extrude']);
    expect(failed.error).toBe('Extruder cannot extrude');
    expect(failed.running).toBe(false);
    expect(parsePaLog(['PA_CALIBRATE', '!! boom', 'PA_CALIBRATE']).error).toBeNull();
  });

  it('takes METHOD from the command echo', () => {
    expect(parsePaLog(['TEST_PRESSURE_ADVANCE METHOD=search_overshoot']).method).toBe('search_overshoot');
  });

  it('ignores unknown lines and the keep-alive noise', () => {
    const r = parsePaLog(['TEST_PRESSURE_ADVANCE', '// Wait for calculations..', '// something else']);
    expect(r.running).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});

describe('run boundaries', () => {
  it('recognises what a fresh run prints first', () => {
    expect(isRunStart('PA_CALIBRATE METHOD=step_response')).toBe(true);
    expect(isRunStart('// Detected extrude_force_sign=-1')).toBe(true);
    expect(isRunStart('// Searching for optimal pressure_advance...')).toBe(true);
    expect(isRunStart('// Tested pressure_advance=0.1 -> overshoot')).toBe(false);
    expect(isRunStart('// ok')).toBe(false);
  });

  it('lastRunLines starts at the last command echo', () => {
    const history = ['G28', ...STEP, 'M115', ...SEARCH];
    expect(lastRunLines(history)).toEqual(SEARCH);
    expect(lastRunLines(['G28', 'M115'])).toEqual([]);
  });

  it('falls back to a start line when the echo is missing', () => {
    const lines = ['// old', '// Detected extrude_force_sign=1', '// PA calibration results:'];
    expect(lastRunLines(lines)).toEqual(lines.slice(1));
  });
});
