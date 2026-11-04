/**
 * Recording a capture in the browser: what motan's data_logger.py does on the printer.
 *
 * Sequence (the same as data_logger): check that Klipper is ready, list its objects,
 * subscribe to the status of ALL of them (the first answer is the initial status and fixes
 * the time zero), then subscribe to the chosen bulk streams. Everything arrives as
 * messages that are kept as they are, in memory, in the shape the decoders read.
 *
 * Klipper has no unsubscribe: a stream runs until the Klippy bridge socket closes. The host
 * closes it when the last listener of a stream is cancelled, so `stop()` is all it takes.
 */
import type { KlippyStreamStatus, MoonrakerProxyHandle } from '../sdk';
import type { DataSource } from './discovery';
import { openStreamWithVariants } from './stream-keys';
import { MotanError, type CaptureData, type StatusTree } from './types';

export type CaptureState = 'idle' | 'starting' | 'recording' | 'stopped' | 'failed';

export interface CaptureLimits {
  /** Stop after this many seconds of printer time. */
  maxSeconds: number;
  /** Stop when the recorded data is estimated to take this much memory. */
  maxBytes: number;
}

export const DEFAULT_CAPTURE_LIMITS: CaptureLimits = { maxSeconds: 60, maxBytes: 200 * 1024 * 1024 };

export interface SourceProgress {
  id: string;
  status: KlippyStreamStatus;
  messages: number;
}

export interface CaptureSnapshot {
  state: CaptureState;
  /** Why the capture failed or stopped on its own (user-facing English text), if it did. */
  reason?: string;
  /** Seconds of printer time recorded so far. */
  elapsed: number;
  /** Estimated memory of the recorded data, bytes. */
  approxBytes: number;
  sources: SourceProgress[];
}

/**
 * Rough in-memory size of one row of each stream's `data`, bytes. Used for the limit and the
 * progress display only: JavaScript numbers in nested arrays take about 4x their JSON text.
 */
const ROW_BYTES: Record<string, number> = {
  trapq: 360,
  stepq: 100,
  accelerometer: 240,
  angle: 120,
  ldc1612: 180,
  loadcell: 200,
  stallguard: 140,
};

/** A message size estimate: its `data` rows times the stream's row size, or a flat guess. */
function estimateBytes(kind: string, params: unknown): number {
  const data = (params as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? 64 + data.length * (ROW_BYTES[kind] ?? 200) : 512;
}

export interface CaptureOptions {
  limits?: Partial<CaptureLimits>;
  /** Called when the state, the progress or a source's status changes. */
  onChange?: (snapshot: CaptureSnapshot) => void;
}

type Handle = Pick<MoonrakerProxyHandle, 'klippyStream' | 'klippyRequest'>;

export class CaptureSession {
  private state: CaptureState = 'idle';
  private reason: string | undefined;
  private readonly limits: CaptureLimits;
  private readonly streams = new Map<string, unknown[]>();
  private readonly acked = new Set<string>();
  private readonly progress = new Map<string, SourceProgress>();
  private readonly kinds = new Map<string, string>();
  private initialStatus: StatusTree | null = null;
  private startTime = 0;
  private latestTime = 0;
  private bytes = 0;
  private cancels: Array<() => void> = [];
  private result: CaptureData | null = null;

  constructor(
    private readonly handle: Handle,
    private readonly sources: readonly DataSource[],
    private readonly options: CaptureOptions = {},
  ) {
    this.limits = { ...DEFAULT_CAPTURE_LIMITS, ...options.limits };
    for (const s of sources) {
      this.kinds.set(s.id, s.kind);
      this.progress.set(s.id, { id: s.id, status: 'connecting', messages: 0 });
    }
  }

  snapshot(): CaptureSnapshot {
    return {
      state: this.state,
      reason: this.reason,
      elapsed: Math.max(0, this.latestTime - this.startTime),
      approxBytes: this.bytes,
      sources: [...this.progress.values()].map((p) => ({ ...p })),
    };
  }

  /** The recorded data once the capture has stopped or failed (partial data after a failure), else null. */
  getCapture(): CaptureData | null {
    return this.result;
  }

  private changed(): void {
    this.options.onChange?.(this.snapshot());
  }

  /**
   * Starts recording. Resolves when the status subscription is answered and the stream
   * subscriptions are issued; rejects (and the state becomes `failed`) when Klipper is not
   * ready or does not answer.
   */
  async start(): Promise<void> {
    if (this.state !== 'idle') throw new MotanError('The capture has already been started');
    if (this.sources.length === 0) throw new MotanError('Choose at least one source to record');
    this.state = 'starting';
    this.changed();
    try {
      const info = (await this.handle.klippyRequest('info')) as { state?: string };
      if (info.state !== 'ready') throw new MotanError(`Klipper is not ready (${info.state ?? 'unknown state'})`);
      const list = (await this.handle.klippyRequest('objects/list')) as { objects?: string[] };
      // null = every field of the object, as data_logger.py asks.
      const objects = Object.fromEntries((list.objects ?? []).map((name) => [name, null]));
      await this.subscribeStatus(objects);
    } catch (e) {
      this.fail(e instanceof Error ? e.message : String(e));
      throw e;
    }
    if (this.state !== 'starting') return; // stopped or failed while the answer was on its way

    this.streams.set('status', []);
    for (const source of this.sources) this.openSource(source);
    this.state = 'recording';
    this.changed();
  }

  /** Subscribes to the status of all objects; resolves with the first answer (the initial status). */
  private subscribeStatus(objects: Record<string, null>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      this.cancels.push(
        this.handle.klippyStream(
          'objects/subscribe',
          { objects },
          (params) => this.onStatusUpdate(params),
          (status) => {
            if (status !== 'unavailable') return;
            if (!settled) {
              settled = true;
              reject(new MotanError('The Klippy bridge is not reachable'));
            } else {
              this.fail('The connection to Klipper was lost');
            }
          },
          (ack) => {
            if (settled) return;
            settled = true;
            const status = (ack as { status?: StatusTree } | null)?.status;
            const t = status?.toolhead?.estimated_print_time;
            if (!status || typeof t !== 'number') {
              reject(new MotanError('Klipper did not report toolhead.estimated_print_time'));
              return;
            }
            this.initialStatus = status;
            this.startTime = this.latestTime = t;
            resolve();
          },
        ),
      );
    });
  }

  private openSource(source: DataSource): void {
    this.streams.set(source.id, []);
    this.cancels.push(
      openStreamWithVariants(this.handle, source.method, source.paramVariants, {
        onData: (params) => this.onSourceData(source.id, params),
        onStatus: (status) => {
          this.progress.get(source.id)!.status = status;
          this.changed();
        },
        // Only an acknowledged subscription belongs to the capture (motan does the same).
        onAck: () => {
          this.acked.add(source.id);
        },
      }),
    );
  }

  private onSourceData(id: string, params: unknown): void {
    if (this.state !== 'recording') return;
    this.streams.get(id)!.push(params);
    this.progress.get(id)!.messages += 1;
    this.bytes += estimateBytes(this.kinds.get(id) ?? '', params);
    this.checkLimits();
    this.changed();
  }

  private onStatusUpdate(params: unknown): void {
    if (this.state !== 'recording' && this.state !== 'starting') return;
    const msg = params as { status?: StatusTree } | null;
    const t = msg?.status?.toolhead?.estimated_print_time;
    if (typeof t === 'number') this.latestTime = Math.max(this.latestTime, t);
    if (this.state !== 'recording') return;
    this.streams.get('status')!.push(params);
    this.bytes += 256;
    this.checkLimits();
    this.changed();
  }

  private checkLimits(): void {
    if (this.latestTime - this.startTime >= this.limits.maxSeconds) {
      this.finish('stopped', `Stopped at the time limit of ${this.limits.maxSeconds} s`);
    } else if (this.bytes >= this.limits.maxBytes) {
      this.finish('stopped', 'Stopped at the memory limit');
    }
  }

  private fail(message: string): void {
    if (this.state === 'failed' || this.state === 'stopped') return;
    this.finish('failed', message);
  }

  private finish(state: 'stopped' | 'failed', reason?: string): void {
    for (const cancel of this.cancels) cancel();
    this.cancels = [];
    this.state = state;
    this.reason = reason;
    if (this.initialStatus) {
      this.result = {
        initialStatus: this.initialStatus,
        subscriptions: new Set(this.acked),
        streams: new Map(this.streams),
      };
    }
    this.changed();
  }

  /** Stops recording and returns what was recorded. Safe to call in any state. */
  stop(): CaptureData | null {
    if (this.state === 'recording' || this.state === 'starting') this.finish('stopped');
    return this.result;
  }
}
