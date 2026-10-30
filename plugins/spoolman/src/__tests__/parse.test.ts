import { describe, expect, it } from 'vitest';

import {
  activeToolFromVariables,
  effectiveTools,
  resolveSpoolmanUrl,
  spoolIdForTool,
  toolSpoolsFromVariables,
  toolsFromObjects,
} from '../parse';
import { emptyPrinterState } from '../types';

describe('tools and save_variables', () => {
  it('finds T<n> macros and sorts them numerically', () => {
    expect(toolsFromObjects([
      'gcode_macro T10', 'gcode_macro t1', 'gcode_macro T0', 'gcode_macro TOOL', 'extruder', 'save_variables',
    ])).toEqual(['T0', 'T1', 'T10']);
  });

  it('reads t<n>__spool_id per tool', () => {
    expect(toolSpoolsFromVariables({ t0__spool_id: 7, t1__spool_id: '3', t2__spool_id: 0 }, ['T0', 'T1', 'T2', 'T3']))
      .toEqual({ T0: 7, T1: 3, T2: null, T3: null });
  });

  it('reads active_tool as number or name', () => {
    expect(activeToolFromVariables({ active_tool: 1 })).toBe('T1');
    expect(activeToolFromVariables({ active_tool: 't2' })).toBe('T2');
    expect(activeToolFromVariables({})).toBeNull();
    expect(activeToolFromVariables({ active_tool: 'unknown' })).toBeNull();
  });

  it('single-tool printers fall back to Moonraker active spool', () => {
    const single = { ...emptyPrinterState(), activeSpoolId: 5 };
    expect(effectiveTools(single)).toEqual(['T0']);
    expect(spoolIdForTool(single, 'T0')).toBe(5);

    const multi = { ...emptyPrinterState(), tools: ['T0', 'T1'], toolSpools: { T0: 2, T1: null }, activeSpoolId: 5 };
    expect(spoolIdForTool(multi, 'T0')).toBe(2);
    expect(spoolIdForTool(multi, 'T1')).toBeNull();
  });
});

describe('resolveSpoolmanUrl', () => {
  it('prefers the user setting', () => {
    expect(resolveSpoolmanUrl(' http://spools.lan/ ', 'http://localhost:7912', '192.168.1.5')).toBe('http://spools.lan/');
  });

  it('replaces a loopback host with the printer host', () => {
    expect(resolveSpoolmanUrl(undefined, 'http://localhost:7912', '192.168.1.5')).toBe('http://192.168.1.5:7912/');
    expect(resolveSpoolmanUrl(undefined, 'http://127.0.0.1:7912', 'http://voron.local:7125')).toBe('http://voron.local:7912/');
  });

  it('keeps a real host as is', () => {
    expect(resolveSpoolmanUrl(undefined, 'http://10.0.0.2:7912', '192.168.1.5')).toBe('http://10.0.0.2:7912/');
  });

  it('returns null without any address', () => {
    expect(resolveSpoolmanUrl('', undefined, '192.168.1.5')).toBeNull();
    expect(resolveSpoolmanUrl(undefined, 'not a url', '192.168.1.5')).toBeNull();
  });
});
