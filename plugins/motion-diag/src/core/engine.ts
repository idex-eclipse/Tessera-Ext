/**
 * Dataset generation: the AnalyzerManager of motan's analyzers.py.
 *
 * Given a capture and a list of dataset names, it samples every raw dataset on a fixed
 * time grid (`segmentTime`) and then derives the analyzers' datasets from the sampled
 * arrays. Sampling is the slow part, so it runs in chunks and yields to the event loop
 * between them: the UI stays responsive without a Web Worker (a Blob worker would need
 * `worker-src blob:` in the page's CSP, which the default Tessera install does not allow).
 */
import { createAnalyzer, type Analyzer, type AnalyzerHost } from './analyzers';
import { createRawDecoder, isRawDatasetType, type RawDecoder } from './decoders';
import { LogContext } from './log-model';
import { nameSplit } from './names';
import { MotanError, type CaptureData, type DatasetLabel, type StatusTree } from './types';

/** motan's defaults (data_export.py / motan_graph.py). */
export const DEFAULT_SEGMENT_TIME = 0.0001;
export const DEFAULT_DURATION = 5;

export interface GenerateOptions {
  /** Time step of the grid, seconds (motan `--segment-time`). */
  segmentTime: number;
  /** Seconds from the start of the capture to the first sample (motan `--skip`). */
  skip: number;
  /** Length of the exported window, seconds (motan `--duration`). */
  duration: number;
  /** Samples decoded between two yields to the event loop (default 4000). */
  chunk?: number;
  /** Aborts a running generation; the promise rejects with an AbortError. */
  signal?: AbortSignal;
  /** Progress of the sampling phase, 0..1. */
  onProgress?: (fraction: number) => void;
}

export interface GeneratedData {
  /** Seconds since the start of the capture, one per sample (motan's "Time (s)"). */
  times: Float64Array;
  /** One array per requested dataset name, aligned with `times`. */
  series: Map<string, Float64Array>;
  labels: Map<string, DatasetLabel>;
}

/** Gives the event loop a turn (scheduler.yield where the browser has it). */
function yieldToEventLoop(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (sched?.yield) return sched.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function abortError(): Error {
  const e = new Error('Generation aborted');
  e.name = 'AbortError';
  return e;
}

class Manager implements AnalyzerHost {
  readonly ctx: LogContext;
  private readonly raw = new Map<string, RawDecoder>();
  private readonly gen = new Map<string, Analyzer>();
  private readonly data = new Map<string, Float64Array>();

  constructor(
    capture: CaptureData,
    readonly segmentTime: number,
  ) {
    this.ctx = new LogContext(capture);
  }

  get initialStatus(): StatusTree {
    return this.ctx.initialStatus;
  }

  rawDecoders(): ReadonlyMap<string, RawDecoder> {
    return this.raw;
  }

  generatedAnalyzers(): ReadonlyMap<string, Analyzer> {
    return this.gen;
  }

  setupDataset(rawName: string): void {
    const name = rawName.trim();
    if (this.raw.has(name) || this.gen.has(name)) return;
    const parts = nameSplit(name);
    if (isRawDatasetType(parts[0]!)) {
      this.raw.set(name, createRawDecoder(this.ctx, name));
    } else {
      // Dependencies register themselves while the analyzer is created, so they end up
      // ahead of it in `gen` and are generated first.
      this.gen.set(name, createAnalyzer(this, name, parts));
    }
  }

  getLabel(rawName: string): DatasetLabel {
    const name = rawName.trim();
    const hdl = this.raw.get(name) ?? this.gen.get(name);
    if (!hdl) throw new MotanError(`Unknown dataset '${name}'`);
    return hdl.label();
  }

  getData(name: string): Float64Array {
    const d = this.data.get(name.trim());
    if (!d) throw new MotanError(`Dataset '${name}' has not been generated`);
    return d;
  }

  setData(name: string, data: Float64Array): void {
    this.data.set(name, data);
  }
}

/**
 * Samples and derives `columns` from `capture`, as `data_export.py -c ...` does.
 * Throws MotanError for an unknown dataset, a dataset the capture does not contain, or a
 * parameter that cannot be used.
 */
export async function generateDatasets(
  capture: CaptureData,
  columns: readonly string[],
  options: GenerateOptions,
): Promise<GeneratedData> {
  const { segmentTime, skip, duration, signal } = options;
  if (!(segmentTime > 0)) throw new MotanError('The time step must be positive');
  if (!(duration > 0)) throw new MotanError('The duration must be positive');
  const chunk = Math.max(1, options.chunk ?? 4000);

  const mgr = new Manager(capture, segmentTime);
  for (const column of columns) mgr.setupDataset(column);

  // The time grid is built by accumulation, exactly as motan does, so the sample times
  // are bit-identical to its output.
  const initialStart = mgr.ctx.initialStartTime;
  const startTime = initialStart + skip;
  const endTime = startTime + duration;
  const absTimes: number[] = [];
  const relTimes: number[] = [];
  for (let t = startTime; t < endTime; ) {
    t += segmentTime;
    absTimes.push(t);
    relTimes.push(t - initialStart);
  }
  const n = absTimes.length;

  // Raw datasets: sample every decoder at every time step.
  const decoders = [...mgr.rawDecoders().entries()].map(([name, dec]) => ({ name, dec, out: new Float64Array(n) }));
  for (let i = 0; i < n; i++) {
    const t = absTimes[i]!;
    for (const d of decoders) d.out[i] = d.dec.pull(t);
    if ((i + 1) % chunk === 0) {
      if (signal?.aborted) throw abortError();
      options.onProgress?.((i + 1) / n);
      await yieldToEventLoop();
    }
  }
  for (const d of decoders) mgr.setData(d.name, d.out);
  options.onProgress?.(1);

  // Analyzers, in dependency order (insertion order of the manager).
  for (const [name, analyzer] of mgr.generatedAnalyzers()) {
    if (signal?.aborted) throw abortError();
    mgr.setData(name, analyzer.generate());
    await yieldToEventLoop();
  }

  const series = new Map<string, Float64Array>();
  const labels = new Map<string, DatasetLabel>();
  for (const column of columns) {
    series.set(column, mgr.getData(column));
    labels.set(column, mgr.getLabel(column));
  }
  return { times: Float64Array.from(relTimes), series, labels };
}

/**
 * Labels (name and units) of datasets without sampling anything: what a chart axis or a
 * legend needs before the data is computed. A dataset that cannot be set up maps to the
 * error message instead, so the UI can explain why.
 */
export function describeDatasets(
  capture: CaptureData,
  names: readonly string[],
  segmentTime = DEFAULT_SEGMENT_TIME,
): Map<string, DatasetLabel | MotanError> {
  const mgr = new Manager(capture, segmentTime);
  const out = new Map<string, DatasetLabel | MotanError>();
  for (const name of names) {
    try {
      mgr.setupDataset(name);
      out.set(name, mgr.getLabel(name));
    } catch (e) {
      out.set(name, e instanceof MotanError ? e : new MotanError(e instanceof Error ? e.message : String(e)));
    }
  }
  return out;
}
