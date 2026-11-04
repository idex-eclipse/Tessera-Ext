/**
 * Shared by the golden tests: runs every case of a fixture folder (cases.json + the CSVs
 * Klipper's real data_export.py wrote) through the browser port and compares the tables.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { csvColumnHeader } from '../../core/export-csv';
import { generateDatasets } from '../../core/engine';
import { loadMotanLog } from './motan-log';

export interface Case {
  id: string;
  columns: string[];
  skip: number;
  duration: number;
  segmentTime: number;
  csv: string;
}

/** Minimal CSV reader (quoted cells, blank lines skipped; Python wrote them on Windows). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r*\n/)) {
    if (line === '') continue;
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

/** Tolerance: motan sums with Python's compensated sum() on 3.12+, JS adds plainly. */
const REL_TOL = 1e-9;

/** Registers one test per case of `dir` (a URL ending in "/") against the log `<dir>/log`. */
export function describeGolden(title: string, dir: URL): void {
  const meta = JSON.parse(readFileSync(new URL('cases.json', dir), 'utf8')) as { cases: Case[] };
  const capture = loadMotanLog(fileURLToPath(new URL('log', dir)));

  describe(title, () => {
    for (const tc of meta.cases) {
      it(tc.id, async () => {
        const expected = parseCsv(readFileSync(new URL(tc.csv, dir), 'utf8'));
        const header = expected[0]!;
        const rows = expected.slice(1);

        const out = await generateDatasets(capture, tc.columns, {
          segmentTime: tc.segmentTime,
          skip: tc.skip,
          duration: tc.duration,
          chunk: 100_000,
        });

        expect(['Time (s)', ...tc.columns.map((c) => csvColumnHeader(out.labels.get(c)!))]).toEqual(header);
        expect(out.times.length).toBe(rows.length);

        for (const [ci, column] of tc.columns.entries()) {
          const series = out.series.get(column)!;
          let worst = 0;
          let worstAt = -1;
          for (let r = 0; r < rows.length; r++) {
            const cell = rows[r]![ci + 1]!;
            const want = cell === '' ? Number.NaN : Number(cell);
            const got = series[r]!;
            if (Number.isNaN(want)) {
              expect(got, `${column} row ${r}`).toBeNaN();
              continue;
            }
            // `!(err <= worst)` also catches a NaN error (got is NaN, want is not).
            const err = Math.abs(got - want) / Math.max(1, Math.abs(want));
            if (!(err <= worst)) {
              worst = err;
              worstAt = r;
            }
          }
          expect(worst, `${column}: worst relative error at row ${worstAt}`).toBeLessThan(REL_TOL);
        }
        // The time axis is built by the same accumulation, so it matches closely too.
        for (let r = 0; r < rows.length; r++) {
          expect(Math.abs(out.times[r]! - Number(rows[r]![0]))).toBeLessThan(1e-9);
        }
      });
    }
  });
}
