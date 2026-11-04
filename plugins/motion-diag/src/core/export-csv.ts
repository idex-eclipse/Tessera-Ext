/**
 * CSV export in the format of motan's data_export.py: a "Time (s)" column followed by one
 * column per dataset, headed "<label> <unit>" (just the label when the unit is unknown).
 */
import type { GeneratedData } from './engine';
import type { DatasetLabel } from './types';

/** Header cell of a dataset column, as data_export.export_csv builds it. */
export function csvColumnHeader(label: DatasetLabel): string {
  const unit = label.units.split('\n').at(-1)!;
  return unit === 'Unknown' ? label.label : `${label.label} ${unit}`;
}

/** Quotes a cell the way Python's csv module does (only when it has a delimiter, quote or newline). */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * The computed datasets as CSV, in data_export.py's layout: "Time (s)" first, then one
 * column per dataset in the given order. A gap (NaN) is an empty cell, as Python writes None.
 */
export function buildCsv(data: GeneratedData, columns: readonly string[]): string {
  const cols = columns.filter((c) => data.series.has(c));
  const lines: string[] = [['Time (s)', ...cols.map((c) => csvColumnHeader(data.labels.get(c)!))].map(csvCell).join(',')];
  const arrays = cols.map((c) => data.series.get(c)!);
  for (let i = 0; i < data.times.length; i++) {
    let line = String(data.times[i]);
    for (const a of arrays) {
      const v = a[i]!;
      line += Number.isNaN(v) ? ',' : `,${v}`;
    }
    lines.push(line);
  }
  return lines.join('\n') + '\n';
}
