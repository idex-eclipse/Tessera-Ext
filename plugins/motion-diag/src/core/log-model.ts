/**
 * Read access to a capture, the role of motan's LogManager / JsonDispatcher / TrackStatus.
 *
 * motan streams a log file and routes each message into per-handler queues; with the whole
 * capture in memory each handler simply owns a cursor over the messages of its
 * subscription, which yields the same sequence. (motan's `req_time + 1. < last_read_time`
 * early exit never fires because it looks for `toolhead` at the wrong nesting level, so
 * dropping it changes nothing.)
 */
import { captureStartTime, type CaptureData, type StatusTree } from './types';

/** Forward-only reader of one subscription's messages. */
export class MessageCursor<T> {
  private pos = 0;
  constructor(private readonly messages: readonly T[]) {}

  /** The next message, or null at the end of the capture. */
  pull(): T | null {
    return this.pos < this.messages.length ? this.messages[this.pos++]! : null;
  }
}

/** Shape of one `status` stream message. */
interface StatusMessage {
  eventtime?: number;
  status: StatusTree;
}

/**
 * Replays the status updates against the print time (motan's TrackStatus): the status
 * visible at print time `t` is the initial status plus every update whose own
 * `toolhead.estimated_print_time` is not later than `t`.
 */
export class StatusTracker {
  private readonly status: StatusTree;
  private nextStatusTime = 0;
  private nextUpdate: StatusTree = {};

  constructor(
    initial: StatusTree,
    private readonly cursor: MessageCursor<StatusMessage>,
  ) {
    // motan shares the inner dicts with the initial status and mutates them; a copy keeps
    // `initialStatus` stable, which nothing in motan relies on being changed.
    this.status = {};
    for (const [k, v] of Object.entries(initial)) this.status[k] = { ...v };
  }

  /** Status at `reqTime` and the print time until which it stays valid. */
  pullStatus(reqTime: number): { status: StatusTree; validUntil: number } {
    for (;;) {
      if (reqTime < this.nextStatusTime) return { status: this.status, validUntil: this.nextStatusTime };
      for (const [k, v] of Object.entries(this.nextUpdate)) {
        this.status[k] = Object.assign(this.status[k] ?? {}, v);
      }
      const msg = this.cursor.pull();
      if (msg === null) {
        this.nextStatusTime = reqTime + 0.1;
        this.nextUpdate = {};
        return { status: this.status, validUntil: this.nextStatusTime };
      }
      this.nextUpdate = msg.status;
      const t = msg.status.toolhead?.estimated_print_time;
      this.nextStatusTime = typeof t === 'number' ? t : 0;
    }
  }
}

/** Everything a decoder or analyzer may ask a capture for. */
export class LogContext {
  /** `toolhead.estimated_print_time` at the start: the zero of every time axis. */
  readonly initialStartTime: number;
  private tracker: StatusTracker | null = null;

  constructor(readonly capture: CaptureData) {
    this.initialStartTime = captureStartTime(capture);
  }

  get initialStatus(): StatusTree {
    return this.capture.initialStatus;
  }

  /** The `configfile.settings` section of the initial status ({} when absent). */
  get config(): Record<string, Record<string, unknown>> {
    const settings = this.capture.initialStatus.configfile?.settings;
    return (settings ?? {}) as Record<string, Record<string, unknown>>;
  }

  hasSubscription(id: string): boolean {
    return this.capture.subscriptions.has(id);
  }

  /** A fresh cursor over a subscription's messages (empty when the stream has none). */
  cursor<T>(subscriptionId: string): MessageCursor<T> {
    return new MessageCursor<T>((this.capture.streams.get(subscriptionId) ?? []) as readonly T[]);
  }

  /** The shared status tracker; created on first use like motan's `get_status_tracker`. */
  statusTracker(): StatusTracker {
    if (this.tracker === null) {
      this.tracker = new StatusTracker(this.capture.initialStatus, this.cursor<StatusMessage>('status'));
    }
    return this.tracker;
  }
}
