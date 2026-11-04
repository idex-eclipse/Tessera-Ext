/**
 * The graphs a user lays out: rows of series, with motan's rules for the vertical axes.
 *
 * In motan_graph.py a graph is a row (one subplot) of datasets; the first dataset's units
 * give the left axis, the first dataset with other units opens a second axis on the right,
 * and a third unit kind falls back to the left axis with the title "Unknown".
 */
import type { DatasetLabel } from './types';

export interface SeriesSpec {
  /** The dataset (motan name). */
  name: string;
  /** CSS color or a theme token like `var(--accent)`; empty = next from the palette. */
  color: string;
  /** 0..1, motan's default is 0.8. */
  alpha: number;
}

export interface GraphRow {
  id: string;
  series: SeriesSpec[];
}

export interface GraphConfig {
  rows: GraphRow[];
}

export const DEFAULT_ALPHA = 0.8;

/** Theme tokens the series colors cycle through (the host defines them for both themes). */
export const PALETTE = ['--accent', '--heat', '--cool', '--success', '--danger', '--warning', '--text-secondary'] as const;

let counter = 0;
/** A short id unique within the session, for rows. */
export function newId(prefix = 'g'): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter}`;
}

export function newSeries(name: string, color = ''): SeriesSpec {
  return { name, color, alpha: DEFAULT_ALPHA };
}

export function newRow(names: string[] = []): GraphRow {
  return { id: newId(), series: names.map((n) => newSeries(n)) };
}

/** Where a series is drawn. */
export type AxisSide = 'left' | 'right';

export interface RowAxes {
  /** Per series: the axis it is drawn on. */
  sides: AxisSide[];
  /** Axis titles (the units text; "Unknown" when a third kind of units had to share the left axis). */
  left: string;
  right: string | null;
}

/** motan's twin-axis logic (plot_motion) over the labels of a row's series. */
export function assignAxes(labels: readonly DatasetLabel[]): RowAxes {
  let left: string | null = null;
  let right: string | null = null;
  const sides: AxisSide[] = [];
  for (const label of labels) {
    if (left === null) {
      left = label.units;
      sides.push('left');
    } else if (label.units !== left) {
      if (right === null) {
        right = label.units;
        sides.push('right');
      } else if (label.units === right) {
        sides.push('right');
      } else {
        // A third kind of units: motan retitles the left axis and plots there.
        left = 'Unknown';
        sides.push('left');
      }
    } else {
      sides.push('left');
    }
  }
  return { sides, left: left ?? '', right };
}
