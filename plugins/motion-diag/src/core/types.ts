/**
 * Shared types of the motan port.
 *
 * Vocabulary follows Klipper's scripts/motan (data_logger.py, readlog.py, analyzers.py) so
 * the code can be compared with it line by line: a *capture* is what data_logger.py would
 * have written to disk, a *dataset* is a named series sampled on a fixed time grid.
 */

/** Klipper status tree: `{ object name: { field: value } }`. */
export type StatusTree = Record<string, Record<string, unknown>>;

/** Axis label of a dataset. `units` may hold a line break ("Position\n(mm)"), as in motan. */
export interface DatasetLabel {
  label: string;
  units: string;
}

/**
 * A finished capture, in memory.
 *
 * Equivalent of motan's log pair `<name>.json.gz` + `<name>.index.gz`: the first index
 * entry (initial status + acknowledged subscriptions) and the stream of messages.
 */
export interface CaptureData {
  /** Full status at the start of the capture (the answer to `objects/subscribe`). */
  initialStatus: StatusTree;
  /**
   * Ids of the subscriptions that were acknowledged, e.g. `trapq:toolhead`,
   * `accelerometer:hotend`. A dataset can only be decoded when its subscription is here.
   */
  subscriptions: ReadonlySet<string>;
  /**
   * The `params` of every message, in arrival order, per subscription id.
   * The id `status` holds the status updates `{ eventtime, status }`.
   */
  streams: ReadonlyMap<string, readonly unknown[]>;
}

/** Error with a message meant for the user (unknown dataset, bad parameter, ...). */
export class MotanError extends Error {
  override name = 'MotanError';
}

/** `estimated_print_time` of the initial status: the zero of every dataset's time axis. */
export function captureStartTime(capture: CaptureData): number {
  const t = capture.initialStatus.toolhead?.estimated_print_time;
  if (typeof t !== 'number') throw new MotanError('The capture has no toolhead.estimated_print_time');
  return t;
}
