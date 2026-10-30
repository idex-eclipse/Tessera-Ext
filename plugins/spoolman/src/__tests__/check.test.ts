import { describe, expect, it } from 'vitest';

import { evaluate, materialFor, parseMetadata, sameMaterial } from '../check';
import type { Spool } from '../types';

function spool(p: { id?: number; material?: string; remaining_weight?: number; remaining_length?: number }): Spool {
  return {
    id: p.id ?? 1,
    remaining_weight: p.remaining_weight,
    remaining_length: p.remaining_length,
    filament: { id: 1, material: p.material },
  };
}

describe('parseMetadata', () => {
  it('reads a single-material file', () => {
    const f = parseMetadata({ filament_type: 'PLA', filament_weight_total: 12.5, filament_total: 4100 });
    expect(f).toEqual({ tools: [0], types: ['PLA'], weights: [], lengths: [], totalWeight: 12.5, totalLength: 4100 });
  });

  it('accepts every filament_type shape, keeping positions', () => {
    expect(parseMetadata({ filament_type: 'PLA;PETG; PLA' }).types).toEqual(['PLA', 'PETG', 'PLA']);
    expect(parseMetadata({ filament_type: ['PLA', 'PETG'] }).types).toEqual(['PLA', 'PETG']);
    expect(parseMetadata({ filament_type: '["PLA","","ABS"]' }).types).toEqual(['PLA', '', 'ABS']);
  });

  it('derives used tools from per-extruder usage (unused slots are 0)', () => {
    const f = parseMetadata({
      filament_type: 'PLA;PETG;PLA;PLA',
      filament_weight: [3.2, 0, 7.5, 0],
      filament_length: '[1000,0,2400,0]',
      filament_weight_total: 10.7,
    });
    expect(f.tools).toEqual([0, 2]);
    expect(f.weights).toEqual([3.2, undefined, 7.5, undefined]);
    expect(f.lengths).toEqual([1000, undefined, 2400, undefined]);
  });

  it('treats an array filament_total as per-extruder lengths', () => {
    const f = parseMetadata({ filament_total: [1500, 0, 500] });
    expect(f.lengths).toEqual([1500, undefined, 500]);
    expect(f.totalLength).toBe(2000);
    expect(f.tools).toEqual([0, 2]);
  });

  it('prefers referenced_tools when present', () => {
    expect(parseMetadata({ referenced_tools: [1], filament_weight: [5, 5] }).tools).toEqual([1]);
  });

  it('survives missing metadata', () => {
    expect(parseMetadata(null)).toEqual({
      tools: [0], types: [], weights: [], lengths: [], totalWeight: undefined, totalLength: undefined,
    });
  });
});

describe('material', () => {
  it('compares case- and space-insensitively', () => {
    expect(sameMaterial(' pla ', 'PLA')).toBe(true);
    expect(sameMaterial('PLA+', 'PLA')).toBe(false);
  });

  it('uses the only type for every extruder of a single-material file', () => {
    expect(materialFor(parseMetadata({ filament_type: 'ABS' }), 1)).toBe('ABS');
    expect(materialFor(parseMetadata({ filament_type: 'PLA;PETG' }), 1)).toBe('PETG');
    expect(materialFor(parseMetadata({ filament_type: 'PLA;PETG' }), 3)).toBe('');
  });
});

describe('evaluate', () => {
  const file = parseMetadata({ filament_type: 'PLA', filament_weight_total: 50, filament_total: 16000 });

  it('passes when the spool matches and has enough filament', () => {
    expect(evaluate(file, () => spool({ material: 'pla', remaining_weight: 300 }))).toEqual([]);
  });

  it('reports a missing spool', () => {
    expect(evaluate(file, () => null)).toEqual([{ kind: 'no-spool', tool: 'T0' }]);
  });

  it('reports a material mismatch', () => {
    expect(evaluate(file, () => spool({ material: 'PETG', remaining_weight: 300 }))).toEqual([
      { kind: 'material', tool: 'T0', expected: 'PLA', actual: 'PETG' },
    ]);
  });

  it('reports insufficient weight', () => {
    expect(evaluate(file, () => spool({ material: 'PLA', remaining_weight: 20 }))).toEqual([
      { kind: 'insufficient', tool: 'T0', unit: 'g', required: 50, remaining: 20 },
    ]);
  });

  it('falls back to length when the spool has no weight', () => {
    expect(evaluate(file, () => spool({ material: 'PLA', remaining_length: 1000 }))).toEqual([
      { kind: 'insufficient', tool: 'T0', unit: 'mm', required: 16000, remaining: 1000 },
    ]);
  });

  it('skips checks the data does not allow', () => {
    const bare = parseMetadata({});
    expect(evaluate(bare, () => spool({ material: 'PETG' }))).toEqual([]);
  });

  it('checks per-tool length when a spool has no weight', () => {
    const multi = parseMetadata({ filament_type: 'PLA;PLA', filament_length: [3000, 9000] });
    const spools: Record<number, Spool | null> = {
      0: spool({ id: 1, material: 'PLA', remaining_length: 5000 }),
      1: spool({ id: 2, material: 'PLA', remaining_length: 5000 }),
    };
    expect(evaluate(multi, (i) => spools[i] ?? null)).toEqual([
      { kind: 'insufficient', tool: 'T1', unit: 'mm', required: 9000, remaining: 5000 },
    ]);
  });

  it('checks every used tool, with per-tool weights only', () => {
    const multi = parseMetadata({
      filament_type: 'PLA;PETG',
      referenced_tools: [0, 1],
      filament_weight_total: 500, // not attributable to a tool → ignored
      filament_weight: [10],
    });
    const spools: Record<number, Spool | null> = {
      0: spool({ id: 1, material: 'PLA', remaining_weight: 5 }),
      1: spool({ id: 2, material: 'PLA', remaining_weight: 1 }),
    };
    expect(evaluate(multi, (i) => spools[i] ?? null)).toEqual([
      { kind: 'insufficient', tool: 'T0', unit: 'g', required: 10, remaining: 5 },
      { kind: 'material', tool: 'T1', expected: 'PETG', actual: 'PLA' },
    ]);
  });
});
