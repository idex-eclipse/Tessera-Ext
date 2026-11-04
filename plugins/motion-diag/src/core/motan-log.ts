/**
 * Klipper's motan log format, read and written, so a capture can go both ways between
 * this tab and the real tools (`motan_graph.py`, `motan_graph.py --export`, ...).
 *
 * `data_logger.py` writes a pair of files:
 *   <name>.json.gz   every message of the capture, each terminated by 0x03, gzip
 *   <name>.index.gz  periodic snapshots of the status; the first one holds the initial
 *                    status and the acknowledged subscriptions
 *
 * Here the pair is bundled as one `<name>.tar.gz` for download, and either the bundle or
 * the two loose files can be opened again. The index we write has a single snapshot: motan
 * only seeks inside the log when it finds more, so `--skip` still works (it reads from the
 * start), just without the speed-up of a real index.
 */
import { gunzip, gzip, tarCreate, tarExtract } from './archive';
import { MotanError, type CaptureData, type StatusTree } from './types';

const ETX = '\x03';
const enc = new TextEncoder();
const dec = new TextDecoder();

export interface MotanLogFiles {
  /** Uncompressed content of `<name>.json.gz`. */
  json: Uint8Array;
  /** Uncompressed content of `<name>.index.gz`. */
  index: Uint8Array;
}

/**
 * The two log files of a capture, uncompressed. The data messages of different streams are
 * interleaved in proportion to their progress, which keeps motan's memory use down compared
 * with writing one stream after another (it reads the file once and queues what it passes).
 */
export function serializeMotanLog(capture: CaptureData): MotanLogFiles {
  const startTime = capture.initialStatus.toolhead?.estimated_print_time;
  const out: string[] = [];
  const msg = (m: unknown): void => {
    out.push(JSON.stringify(m), ETX);
  };
  msg({ id: 'info', result: { state: 'ready' } });
  msg({ id: 'list', result: { objects: Object.keys(capture.initialStatus) } });
  msg({ id: 'status', result: { eventtime: startTime, status: capture.initialStatus } });
  const subscriptions: Record<string, unknown> = {};
  for (const id of capture.subscriptions) {
    subscriptions[id] = { header: [] };
    msg({ id, result: { header: [] } });
  }

  const order: Array<{ at: number; q: string; params: unknown }> = [];
  for (const [q, list] of capture.streams) {
    list.forEach((params, i) => order.push({ at: (i + 0.5) / list.length, q, params }));
  }
  order.sort((a, b) => a.at - b.at);
  for (const m of order) msg({ q: m.q, params: m.params });

  const index = JSON.stringify({ status: capture.initialStatus, subscriptions, file_position: 0 }) + ETX;
  return { json: enc.encode(out.join('')), index: enc.encode(index) };
}

/** Reads a log pair (uncompressed contents) into a capture. */
export function parseMotanLog(files: MotanLogFiles): CaptureData {
  const first = dec.decode(files.index).split(ETX).find((part) => part.length > 0);
  if (!first) throw new MotanError('The index file is empty');
  let index: { status?: StatusTree; subscriptions?: Record<string, unknown> };
  try {
    index = JSON.parse(first);
  } catch {
    throw new MotanError('The index file cannot be read');
  }
  if (!index.status?.toolhead || typeof index.status.toolhead.estimated_print_time !== 'number') {
    throw new MotanError('The log has no toolhead.estimated_print_time in its initial status');
  }

  const streams = new Map<string, unknown[]>();
  for (const part of dec.decode(files.json).split(ETX)) {
    if (part.length === 0) continue;
    let m: { q?: unknown; params?: unknown };
    try {
      m = JSON.parse(part);
    } catch {
      continue; // a message cut short by a killed logger, or garbage: motan skips it too
    }
    if (typeof m.q !== 'string') continue; // answers to our requests, not data
    let list = streams.get(m.q);
    if (!list) streams.set(m.q, (list = []));
    list.push(m.params);
  }
  return {
    initialStatus: index.status,
    subscriptions: new Set(Object.keys(index.subscriptions ?? {})),
    streams,
  };
}

/** `<name>.tar.gz` holding `<name>.json.gz` and `<name>.index.gz`, ready for download. */
export async function exportMotanArchive(capture: CaptureData, name = 'dump'): Promise<Uint8Array> {
  const { json, index } = serializeMotanLog(capture);
  const [jsonGz, indexGz] = await Promise.all([gzip(json), gzip(index)]);
  return gzip(
    tarCreate([
      { name: `${name}.json.gz`, data: jsonGz },
      { name: `${name}.index.gz`, data: indexGz },
    ]),
  );
}

export interface NamedFile {
  name: string;
  data: Uint8Array;
}

const isTarGz = (name: string): boolean => /\.(tar\.gz|tgz)$/i.test(name);

/**
 * Opens what the user picked: a `.tar.gz` bundle, or the two loose files
 * (`*.json.gz` and `*.index.gz`) together.
 */
export async function importMotanFiles(files: readonly NamedFile[]): Promise<CaptureData> {
  let jsonGz: Uint8Array | undefined;
  let indexGz: Uint8Array | undefined;
  const take = (name: string, data: Uint8Array): void => {
    if (/\.index\.gz$/i.test(name)) indexGz ??= data;
    else if (/\.json\.gz$/i.test(name)) jsonGz ??= data;
  };
  for (const f of files) {
    if (isTarGz(f.name)) {
      let tar: Uint8Array;
      try {
        tar = await gunzip(f.data);
      } catch {
        throw new MotanError(`${f.name} is not a valid archive`);
      }
      for (const entry of tarExtract(tar)) take(entry.name.split('/').pop()!, entry.data);
    } else {
      take(f.name, f.data);
    }
  }
  if (!jsonGz || !indexGz) throw new MotanError('Open a .tar.gz, or both the .json.gz and the .index.gz file of the log');
  try {
    // The log of a logger that was killed has no gzip trailer; what was written is still used.
    const [json, index] = await Promise.all([gunzip(jsonGz, true), gunzip(indexGz, true)]);
    return parseMotanLog({ json, index });
  } catch (e) {
    if (e instanceof MotanError) throw e;
    throw new MotanError('The log files cannot be decompressed');
  }
}

/** Seconds of printer time the capture covers, from its status updates (0 when it has none). */
export function captureDuration(capture: CaptureData): number {
  const start = capture.initialStatus.toolhead?.estimated_print_time;
  if (typeof start !== 'number') return 0;
  let end = start;
  for (const m of (capture.streams.get('status') ?? []) as Array<{ status?: StatusTree }>) {
    const t = m.status?.toolhead?.estimated_print_time;
    if (typeof t === 'number' && t > end) end = t;
  }
  return end - start;
}
