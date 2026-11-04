/**
 * The state of the diagnostics tab, kept OUTSIDE the Custom Elements.
 *
 * The host mounts and unmounts the tab as the user switches tabs, but a recording must keep
 * running and a finished capture must still be there when the user comes back. So the tab
 * only renders this store; the store owns the capture session, the analysis window, the
 * graph layout and the computed data. It is one object per page (the plugin's module is
 * loaded once), reset when the active printer changes.
 */
import { CaptureSession, type CaptureSnapshot } from './core/capture';
import { availablePresets } from './core/presets';
import { captureInfo, nodeToName, type CaptureInfo, type Node } from './core/catalog';
import { discoverSources, type DataSource } from './core/discovery';
import { describeDatasets, generateDatasets, type GeneratedData } from './core/engine';
import { newRow, newSeries, type GraphConfig, type GraphRow, type SeriesSpec } from './core/graph-model';
import { buildCsv } from './core/export-csv';
import { captureDuration, exportMotanArchive, importMotanFiles, type NamedFile } from './core/motan-log';
import { MotanError, type CaptureData, type DatasetLabel } from './core/types';
import type { MoonrakerProxyHandle } from './sdk';

export interface AnalysisWindow {
  /** Seconds from the start of the capture. */
  skip: number;
  /** Length of the analysed window, seconds. */
  duration: number;
  /** Time step of the grid, seconds. */
  segmentTime: number;
}

/** Steps offered in the UI, seconds (motan's default is the first one). */
export const SEGMENT_TIMES = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01] as const;

/** Upper bound of samples per series that the UI computes without a warning. */
export const MAX_SAMPLES = 400_000;

export interface ComputedGraphs {
  data: GeneratedData;
  /** Series that could not be built, with the reason. */
  errors: Map<string, string>;
  window: AnalysisWindow;
}

export type DiscoverState = 'idle' | 'loading' | 'ready' | 'error';

export interface DiagState {
  discover: DiscoverState;
  discoverError: string;
  sources: DataSource[];
  selected: Set<string>;
  maxSeconds: number;
  snapshot: CaptureSnapshot | null;
  capture: CaptureData | null;
  /** Length of the finished capture, seconds of printer time. */
  captureSeconds: number;
  info: CaptureInfo | null;
  window: AnalysisWindow;
  graphs: GraphConfig;
  /** Id of the layout the graphs came from; '' once the user has edited them (a custom layout). */
  preset: string;
  computed: ComputedGraphs | null;
  /** 0..1 while computing, null otherwise. */
  progress: number | null;
  computeError: string;
  /** The graphs or the window changed after the last computation. */
  outdated: boolean;
  /** Why the last attempt to open a log file failed ('' when it did not). */
  openError: string;
}

type Listener = () => void;

/** A step that keeps the series at a size the browser can draw and compute comfortably. */
export function suggestSegmentTime(duration: number): number {
  for (const s of SEGMENT_TIMES) if (duration / s <= 150_000) return s;
  return SEGMENT_TIMES[SEGMENT_TIMES.length - 1]!;
}

export class DiagStore {
  private listeners = new Set<Listener>();
  private session: CaptureSession | null = null;
  private abort: AbortController | null = null;
  private printerId = '';
  state: DiagState = DiagStore.initial();

  /** `getHandle` returns the Moonraker handle of the active printer. */
  constructor(private readonly getHandle: () => Pick<MoonrakerProxyHandle, 'klippyStream' | 'klippyRequest'>) {}

  private static initial(): DiagState {
    return {
      discover: 'idle',
      discoverError: '',
      sources: [],
      selected: new Set(),
      maxSeconds: 60,
      snapshot: null,
      capture: null,
      captureSeconds: 0,
      info: null,
      window: { skip: 0, duration: 5, segmentTime: 0.0001 },
      graphs: { rows: [] },
      preset: '',
      computed: null,
      progress: null,
      computeError: '',
      outdated: false,
      openError: '',
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }

  /** Forgets everything and releases the bridge (printer switched, or the user asked). */
  reset(): void {
    this.session?.stop();
    this.session = null;
    this.abort?.abort();
    this.abort = null;
    this.state = DiagStore.initial();
    this.emit();
  }

  /** Called by the tab on mount: a different printer means the old capture is not this machine's. */
  bindPrinter(printerId: string): void {
    if (this.printerId && this.printerId !== printerId) this.reset();
    this.printerId = printerId;
  }

  // ---- sources ----

  async refreshSources(): Promise<void> {
    this.state.discover = 'loading';
    this.state.discoverError = '';
    this.emit();
    try {
      const sources = await discoverSources(this.getHandle());
      const keep = new Set(sources.map((s) => s.id));
      const selected = new Set([...this.state.selected].filter((id) => keep.has(id)));
      if (selected.size === 0) for (const s of sources) if (s.byDefault) selected.add(s.id);
      this.state.sources = sources;
      this.state.selected = selected;
      this.state.discover = 'ready';
    } catch (e) {
      this.state.discover = 'error';
      this.state.discoverError = e instanceof Error ? e.message : String(e);
    }
    this.emit();
  }

  setSelected(ids: string[], on: boolean): void {
    for (const id of ids) {
      if (on) this.state.selected.add(id);
      else this.state.selected.delete(id);
    }
    this.emit();
  }

  setMaxSeconds(seconds: number): void {
    if (Number.isFinite(seconds) && seconds > 0) this.state.maxSeconds = seconds;
    this.emit();
  }

  // ---- recording ----

  get recording(): boolean {
    const s = this.state.snapshot?.state;
    return s === 'starting' || s === 'recording';
  }

  async startRecording(): Promise<void> {
    if (this.recording) return;
    const chosen = this.state.sources.filter((s) => this.state.selected.has(s.id));
    const session = new CaptureSession(this.getHandle(), chosen, {
      limits: { maxSeconds: this.state.maxSeconds },
      onChange: (snap) => {
        if (this.session !== session) return;
        this.state.snapshot = snap;
        const adopted = (snap.state === 'stopped' || snap.state === 'failed') && !this.state.capture && this.adopt(session, snap);
        this.emit();
        // The first layout is drawn at once: nobody wants to press a second button to see the data.
        if (adopted && this.state.graphs.rows.length > 0) void this.compute();
      },
    });
    this.session = session;
    this.state.capture = null;
    this.state.computed = null;
    this.state.info = null;
    this.state.snapshot = session.snapshot();
    this.emit();
    try {
      await session.start();
    } catch {
      // The session reports the reason in its snapshot.
    }
  }

  stopRecording(): void {
    this.session?.stop();
  }

  /** Takes the finished capture and prepares the analysis settings for it. */
  private adopt(session: CaptureSession, snap: CaptureSnapshot): boolean {
    const capture = session.getCapture();
    if (!capture) return false;
    this.useCapture(capture, snap.elapsed);
    return true;
  }

  /** Makes `capture` the one being analysed and sets up the window and the first layout for it. */
  private useCapture(capture: CaptureData, seconds: number): void {
    this.state.capture = capture;
    this.state.captureSeconds = seconds;
    this.state.info = captureInfo(capture);
    this.state.computed = null;
    const duration = Math.max(0.1, Math.min(60, Math.ceil(seconds * 10) / 10));
    this.state.window = { skip: 0, duration, segmentTime: suggestSegmentTime(duration) };
    this.state.graphs = { rows: [] };
    this.state.preset = '';
    const first = availablePresets(this.state.info)[0];
    if (first) {
      this.state.graphs = first.build(this.state.info);
      this.state.preset = first.id;
    }
    this.state.outdated = this.state.graphs.rows.length > 0;
  }

  /**
   * Opens a capture saved earlier: a motan log pair or the `.tar.gz` of it (also logs made
   * by Klipper's own data_logger.py on the printer).
   */
  async openFiles(files: readonly NamedFile[]): Promise<void> {
    if (this.recording) return;
    this.state.openError = '';
    this.emit();
    try {
      const capture = await importMotanFiles(files);
      this.abort?.abort();
      this.session = null;
      const seconds = captureDuration(capture);
      const counts = [...capture.subscriptions].map((id) => ({
        id,
        status: 'live' as const,
        messages: capture.streams.get(id)?.length ?? 0,
      }));
      this.state.snapshot = { state: 'stopped', elapsed: seconds, approxBytes: 0, sources: counts };
      this.useCapture(capture, seconds);
    } catch (e) {
      this.state.openError = e instanceof Error ? e.message : String(e);
      this.emit();
      return;
    }
    this.emit();
    if (this.state.graphs.rows.length > 0) void this.compute();
  }

  /** The capture as a `.tar.gz` of a motan log pair; null without a capture. */
  async exportMotan(baseName = 'dump'): Promise<Blob | null> {
    if (!this.state.capture) return null;
    const bytes = await exportMotanArchive(this.state.capture, baseName);
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/gzip' });
  }

  /** The computed graphs' data as CSV text; null before anything is built. */
  exportCsv(): string | null {
    const c = this.state.computed;
    if (!c) return null;
    const columns = [...new Set(this.state.graphs.rows.flatMap((r) => r.series.map((s) => s.name)))];
    return buildCsv(c.data, columns);
  }

  /** Drops the capture (not the sources or the selection). */
  discardCapture(): void {
    this.abort?.abort();
    this.session = null;
    this.state.snapshot = null;
    this.state.capture = null;
    this.state.info = null;
    this.state.computed = null;
    this.state.progress = null;
    this.state.graphs = { rows: [] };
    this.state.preset = '';
    this.emit();
  }

  // ---- window and graphs ----

  setWindow(patch: Partial<AnalysisWindow>): void {
    this.state.window = { ...this.state.window, ...patch };
    this.state.outdated = true;
    this.emit();
  }

  /** The graphs were edited by hand: no longer a ready-made layout. */
  private changedGraphs(): void {
    this.state.preset = '';
    this.state.outdated = true;
    this.emit();
  }

  applyPreset(id: string): void {
    const info = this.state.info;
    if (!info) return;
    const preset = availablePresets(info).find((p) => p.id === id);
    if (!preset) return;
    this.state.graphs = preset.build(info);
    this.state.preset = preset.id;
    this.state.outdated = true;
    this.emit();
    // Choosing a layout is the request to see it.
    void this.compute();
  }

  addRow(names: string[] = []): GraphRow {
    const row = newRow(names);
    this.state.graphs.rows.push(row);
    this.changedGraphs();
    return row;
  }

  removeRow(rowId: string): void {
    this.state.graphs.rows = this.state.graphs.rows.filter((r) => r.id !== rowId);
    this.changedGraphs();
  }

  /** Adds the dataset built in the dialog to a row (a new row when `rowId` is null). */
  addSeries(rowId: string | null, node: Node): string {
    const info = this.state.info;
    if (!info) throw new MotanError('No capture');
    const name = nodeToName(node, info);
    const labels = describeDatasets(this.state.capture!, [name], this.state.window.segmentTime);
    const label = labels.get(name);
    if (label instanceof MotanError) throw label;
    const row = rowId ? this.state.graphs.rows.find((r) => r.id === rowId) : undefined;
    if (row) row.series.push(newSeries(name));
    else this.state.graphs.rows.push(newRow([name]));
    this.changedGraphs();
    return name;
  }

  updateSeries(rowId: string, index: number, patch: Partial<SeriesSpec>): void {
    const s = this.state.graphs.rows.find((r) => r.id === rowId)?.series[index];
    if (!s) return;
    Object.assign(s, patch);
    // Colors and opacity only restyle: no recomputation is needed, the charts just redraw.
    this.emit();
  }

  removeSeries(rowId: string, index: number): void {
    const row = this.state.graphs.rows.find((r) => r.id === rowId);
    if (!row) return;
    row.series.splice(index, 1);
    this.state.graphs.rows = this.state.graphs.rows.filter((r) => r.series.length > 0);
    this.changedGraphs();
  }

  /** Labels (or the reason a dataset cannot be built) for the series editor. */
  describe(names: string[]): Map<string, DatasetLabel | MotanError> {
    if (!this.state.capture) return new Map();
    return describeDatasets(this.state.capture, names, this.state.window.segmentTime);
  }

  // ---- computing ----

  get computing(): boolean {
    return this.state.progress !== null;
  }

  cancelCompute(): void {
    this.abort?.abort();
  }

  async compute(): Promise<void> {
    const capture = this.state.capture;
    if (!capture || this.computing) return;
    const window = { ...this.state.window };
    const names = [...new Set(this.state.graphs.rows.flatMap((r) => r.series.map((s) => s.name)))];
    // Datasets that cannot be built are reported one by one; the rest are still drawn.
    const labels = describeDatasets(capture, names, window.segmentTime);
    const errors = new Map<string, string>();
    const buildable: string[] = [];
    for (const [name, v] of labels) {
      if (v instanceof MotanError) errors.set(name, v.message);
      else buildable.push(name);
    }
    this.state.computeError = '';
    if (buildable.length === 0) {
      this.state.computed = null;
      this.state.computeError = errors.size > 0 ? [...errors.values()][0]! : '';
      this.state.outdated = false;
      this.emit();
      return;
    }
    this.abort = new AbortController();
    this.state.progress = 0;
    this.emit();
    try {
      const data = await generateDatasets(capture, buildable, {
        ...window,
        signal: this.abort.signal,
        onProgress: (f) => {
          this.state.progress = f;
          this.emit();
        },
      });
      this.state.computed = { data, errors, window };
      this.state.outdated = false;
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        this.state.computeError = e instanceof Error ? e.message : String(e);
        this.state.computed = null;
      }
    } finally {
      this.state.progress = null;
      this.abort = null;
      this.emit();
    }
  }
}
