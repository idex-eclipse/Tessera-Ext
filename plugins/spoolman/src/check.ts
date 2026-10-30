import type { Spool } from './types';

/**
 * Pre-print filament check: pure functions, unit-tested.
 *
 * Input is Moonraker's file metadata (server.files.metadata), which Moonraker
 * extracts from slicer comments. Shapes seen in practice (same handling as
 * Tessera's shared file table, plugins/shared/file-table/FileTable.svelte):
 *   filament_type / _name  "PLA" | "PLA;PETG" | ["PLA","PETG"] | '["PLA","PETG"]'
 *   filament_total         mm: a number for the whole print, or one per extruder
 *   filament_length        mm per extruder
 *   filament_weight        g per extruder
 *   filament_weight_total  g, whole print
 *   referenced_tools       extruder indices used (not every slicer/Moonraker)
 * Per-extruder lists name EVERY filament configured in the slicer project,
 * including unused ones (0 mm / 0 g), so "which tools does this file use" is
 * derived from non-zero usage when referenced_tools is absent.
 * Anything missing is simply not checked — the plugin never blocks a print
 * because of absent metadata.
 */

export interface FileFilament {
  /** Tool indices used by the file; [0] when nothing says otherwise. */
  tools: number[];
  /** Material per extruder index ('' = unknown). */
  types: string[];
  /** Grams per extruder index (undefined = unknown or unused). */
  weights: (number | undefined)[];
  /** Millimetres per extruder index (undefined = unknown or unused). */
  lengths: (number | undefined)[];
  totalWeight?: number;
  totalLength?: number;
}

export type Issue =
  | { kind: 'no-spool'; tool: string }
  | { kind: 'material'; tool: string; expected: string; actual: string }
  | { kind: 'insufficient'; tool: string; unit: 'g' | 'mm'; required: number; remaining: number }
  | { kind: 'unavailable'; message: string };

function num(raw: unknown): number | undefined {
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * A per-extruder list from any of the shapes above. Positions are preserved
 * (empty/invalid entries stay as '' / undefined) because the index IS the tool.
 */
function asList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'number') return [v];
  if (typeof v !== 'string') return [];
  const s = v.trim();
  if (s.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return s ? s.split(';') : [];
}

const asStrings = (v: unknown): string[] => asList(v).map((x) => (x == null ? '' : String(x).trim()));
const asNumbers = (v: unknown): (number | undefined)[] => asList(v).map(num);

export function parseMetadata(raw: unknown): FileFilament {
  const m = (raw ?? {}) as Record<string, unknown>;

  const types = asStrings(m.filament_type);
  const weights = asNumbers(m.filament_weight);

  // filament_total is either the whole-print length or a per-extruder list.
  const totals = asNumbers(m.filament_total);
  const perToolTotals = asList(m.filament_total).length > 1;
  const lengths = m.filament_length != null ? asNumbers(m.filament_length) : perToolTotals ? totals : [];
  const totalLength = perToolTotals
    ? totals.reduce<number>((sum, n) => sum + (n ?? 0), 0) || undefined
    : totals[0];

  let tools = asList(m.referenced_tools)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0);
  if (tools.length === 0) {
    const usage = weights.length >= lengths.length ? weights : lengths;
    tools = usage.flatMap((n, i) => (n !== undefined ? [i] : []));
  }

  return {
    tools: tools.length > 0 ? tools : [0],
    types,
    weights,
    lengths,
    totalWeight: num(m.filament_weight_total),
    totalLength,
  };
}

/** "pla ", "PLA" and "Pla" are the same material; "PLA+" and "PLA" are not. */
export function sameMaterial(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();
  return norm(a) === norm(b);
}

/** Material the file expects in extruder `index`. */
export function materialFor(file: FileFilament, index: number): string {
  // Single-material files list one type for the whole print.
  return (file.types[index] ?? (file.types.length === 1 ? file.types[0] : '') ?? '').trim();
}

/**
 * Checks every tool the file uses against the spool loaded in it.
 * `spoolFor(index)` returns the spool in tool T<index>, or null if none is set.
 */
export function evaluate(file: FileFilament, spoolFor: (index: number) => Spool | null): Issue[] {
  const issues: Issue[] = [];
  const singleTool = file.tools.length === 1;

  for (const index of file.tools) {
    const tool = `T${index}`;
    const spool = spoolFor(index);
    if (!spool) {
      issues.push({ kind: 'no-spool', tool });
      continue;
    }

    const expected = materialFor(file, index);
    const actual = spool.filament.material?.trim() ?? '';
    if (expected && actual && !sameMaterial(expected, actual)) {
      issues.push({ kind: 'material', tool, expected, actual });
    }

    // Prefer weight (what Spoolman tracks natively); fall back to length,
    // which Moonraker reports for every sliced file. Whole-print totals are
    // only attributable to a tool when that tool prints the whole file.
    const requiredWeight = file.weights[index] ?? (singleTool ? file.totalWeight : undefined);
    const requiredLength = file.lengths[index] ?? (singleTool ? file.totalLength : undefined);
    if (requiredWeight !== undefined && spool.remaining_weight !== undefined) {
      if (spool.remaining_weight < requiredWeight) {
        issues.push({ kind: 'insufficient', tool, unit: 'g', required: requiredWeight, remaining: spool.remaining_weight });
      }
    } else if (requiredLength !== undefined && spool.remaining_length !== undefined) {
      if (spool.remaining_length < requiredLength) {
        issues.push({ kind: 'insufficient', tool, unit: 'mm', required: requiredLength, remaining: spool.remaining_length });
      }
    }
  }
  return issues;
}
