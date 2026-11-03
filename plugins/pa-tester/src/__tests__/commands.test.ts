import { describe, expect, it } from 'vitest';

import { COMMANDS, buildCommand, commandDef, parsePaRange, scriptCommands, setPaCommand } from '../commands';

const test = commandDef('test');
const calibrate = commandDef('calibrate');

describe('buildCommand', () => {
  it('always writes the method; empty fields are not sent', () => {
    expect(buildCommand(test, 'step_response', {})).toEqual({
      script: 'TEST_PRESSURE_ADVANCE METHOD=step_response',
      invalid: [],
    });
    expect(buildCommand(calibrate, 'search_overshoot', {}).script).toBe('PA_CALIBRATE METHOD=search_overshoot');
  });

  it('sends the filled fields in table order', () => {
    const b = buildCommand(test, 'step_response', {
      HIGH_FLOW: '12',
      SLOW_FLOW: '2',
      TEST_REPETITIONS: '5',
      FILTER_WINDOW: '0.02',
      EXTRUDE_FORCE_SIGN: '-1',
      EXTRUDER: 'extruder',
      FORCE_SENSOR: 'load_cell',
    });
    expect(b.invalid).toEqual([]);
    expect(b.script).toBe(
      'TEST_PRESSURE_ADVANCE METHOD=step_response SLOW_FLOW=2 HIGH_FLOW=12 TEST_REPETITIONS=5 FILTER_WINDOW=0.02 EXTRUDE_FORCE_SIGN=-1 EXTRUDER=extruder FORCE_SENSOR=load_cell',
    );
  });

  it('reports and drops values the module would reject', () => {
    const b = buildCommand(test, 'step_response', {
      SLOW_FLOW: '0',
      PURGE_LENGTH: 'abc',
      TEST_REPETITIONS: '2.5',
      FILTER_WINDOW: '0.05',
      EXTRUDE_FORCE_SIGN: '2',
      FORCE_SENSOR: 'a b',
    });
    expect(b.invalid.sort()).toEqual(['EXTRUDE_FORCE_SIGN', 'FILTER_WINDOW', 'FORCE_SENSOR', 'PURGE_LENGTH', 'SLOW_FLOW', 'TEST_REPETITIONS']);
    expect(b.script).toBe('TEST_PRESSURE_ADVANCE METHOD=step_response');
  });

  it('high_flow must be greater than slow_flow', () => {
    expect(buildCommand(test, 'step_response', { SLOW_FLOW: '4', HIGH_FLOW: '4' }).invalid).toEqual(['HIGH_FLOW']);
    expect(buildCommand(test, 'step_response', { SLOW_FLOW: '4', HIGH_FLOW: '8' }).invalid).toEqual([]);
  });

  it('PA_RANGE belongs to search_overshoot only', () => {
    const values = { PA_RANGE: ' 0 , 0.2 ' };
    expect(buildCommand(test, 'search_overshoot', values).script).toBe(
      'TEST_PRESSURE_ADVANCE METHOD=search_overshoot PA_RANGE=0,0.2',
    );
    expect(buildCommand(test, 'step_response', values).script).toBe('TEST_PRESSURE_ADVANCE METHOD=step_response');
    expect(buildCommand(test, 'search_overshoot', { PA_RANGE: '0.2,0.1' }).invalid).toEqual(['PA_RANGE']);
  });
});

describe('parsePaRange', () => {
  it('follows the module rules', () => {
    expect(parsePaRange('0,0.2')).toEqual([0, 0.2]);
    expect(parsePaRange('0.1, 1.99')).toEqual([0.1, 1.99]);
    for (const bad of ['', '0.1', '0,2', '0,2.5', '-0.1,0.2', '0.2,0.2', 'a,b', '1,2,3']) {
      expect(parsePaRange(bad), bad).toBeNull();
    }
  });
});

describe('helpers', () => {
  it('the table covers both commands; only PA_CALIBRATE applies', () => {
    expect(COMMANDS.map((c) => [c.gcode, c.applies])).toEqual([
      ['TEST_PRESSURE_ADVANCE', false],
      ['PA_CALIBRATE', true],
    ]);
  });

  it('scriptCommands takes the first word of every non-comment line', () => {
    expect(scriptCommands('G28\n; comment\n  pa_calibrate METHOD=x\n# c\n')).toEqual(['G28', 'PA_CALIBRATE']);
  });

  it('setPaCommand rounds, names a non-default extruder, refuses nonsense', () => {
    expect(setPaCommand(0.04213, 'extruder')).toBe('SET_PRESSURE_ADVANCE ADVANCE=0.0421');
    expect(setPaCommand(0.05, 'extruder1')).toBe('SET_PRESSURE_ADVANCE ADVANCE=0.05 EXTRUDER=extruder1');
    expect(setPaCommand(null, 'extruder')).toBeNull();
    expect(setPaCommand(-1, null)).toBeNull();
    expect(setPaCommand(Number.NaN, null)).toBeNull();
  });
});
