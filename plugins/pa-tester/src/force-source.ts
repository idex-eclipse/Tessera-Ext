import { binSamples, parseForceBatch, type ForceSample, type ForceUnit } from './force-parse';
import { MainsFilter, type MainsHz } from './mains-filter';
import type { LoadCellInfo } from './printer-config';
import type { MoonrakerProxyHandle } from './sdk';

/**
 * Where the live load cell trace comes from.
 *
 * 1. `stream` — `handle.klippyStream('load_cell/dump_force', …)`: the host opens
 *    Moonraker's raw Klippy bridge and delivers every sample the sensor
 *    produces (tens to hundreds per second). The plugin opens no socket itself.
 * 2. `status` — fallback when the bridge is not reachable (nginx without
 *    `/klippysocket`, mixed content) or the host is older than plugin API 0.9:
 *    the regular status subscription of the load cell object, about 4 Hz.
 *
 * The stream asks Klipper to push every sample until it is cancelled, so the
 * caller starts a source only while the graph is on screen and stops it when
 * it is not.
 */

export type SourceKind = 'stream' | 'status';
export type SourceState = 'connecting' | 'live' | 'unavailable';

export interface ForceSink {
  /** New samples (already binned for the chart) and their unit. */
  onSamples(samples: ForceSample[], unit: ForceUnit): void;
  onSource(kind: SourceKind, state: SourceState): void;
  /** Whether the mains filter could act on the data (false: sensor too slow, or status fallback). */
  onMains?(active: boolean): void;
}

/** Chart resolution: samples closer than this are averaged. */
export const BIN_SECONDS = 0.02;

/**
 * `mains` is read for every batch (the user can toggle it while the stream runs) and returns
 * the mains frequency to filter out, or 0 for none. The filter runs on the sensor's own
 * samples, before they are binned for the chart.
 */
export function startForceSource(
  handle: MoonrakerProxyHandle,
  loadCell: LoadCellInfo,
  sink: ForceSink,
  clock: () => number = () => performance.now() / 1000,
  mains: () => MainsHz | 0 = () => 0,
): () => void {
  let comb: MainsFilter | null = null;
  let stopStream: (() => void) | null = null;
  let stopStatus: (() => void) | null = null;
  let stopped = false;

  const startStatus = (): void => {
    if (stopStatus || stopped) return;
    sink.onSource('status', 'connecting');
    stopStatus = handle.subscribe(
      { [loadCell.section]: ['force_g'] },
      (delta: Record<string, { force_g?: unknown } | undefined>) => {
        const g = delta?.[loadCell.section]?.force_g;
        if (typeof g !== 'number' || !Number.isFinite(g)) return;
        sink.onSource('status', 'live');
        // about 4 Hz cannot represent mains hum: report that the filter has nothing to act on
        sink.onMains?.(false);
        sink.onSamples([{ time: clock(), value: g }], 'g');
      },
      { immediate: true },
    );
  };

  const endStatus = (): void => {
    stopStatus?.();
    stopStatus = null;
  };

  if (typeof handle.klippyStream !== 'function') {
    startStatus();
  } else {
    stopStream = handle.klippyStream(
      'load_cell/dump_force',
      { sensor: loadCell.name },
      (params) => {
        const batch = parseForceBatch(params);
        if (!batch.samples.length) return;
        let samples = batch.samples;
        const hz = mains();
        if (hz) {
          if (!comb || comb.period !== 1 / hz) comb = new MainsFilter(hz);
          samples = comb.process(samples);
          sink.onMains?.(comb.active);
        } else {
          comb = null;
        }
        sink.onSamples(binSamples(samples, BIN_SECONDS), batch.unit);
      },
      (state) => {
        if (stopped) return;
        if (state === 'unavailable') {
          sink.onSource('stream', 'unavailable');
          startStatus();
        } else {
          endStatus();
          sink.onSource('stream', state);
        }
      },
    );
  }

  return () => {
    stopped = true;
    stopStream?.();
    stopStream = null;
    endStatus();
  };
}
