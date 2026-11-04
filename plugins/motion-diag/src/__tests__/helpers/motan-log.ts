/**
 * Test helper: reads a log pair written by Klipper's data_logger.py
 * (`<prefix>.json.gz` and `<prefix>.index.gz`) into a CaptureData.
 *
 * It is the way real captures taken with motan can be fed to the browser decoders, so
 * the same code reads both the synthetic fixtures and a user's own log.
 */
import { readFileSync } from 'node:fs';
import { constants, gunzipSync } from 'node:zlib';

import type { CaptureData, StatusTree } from '../../core/types';

/** Messages of a data_logger file: gzip, each message terminated by 0x03. */
function readMessages(path: string): unknown[] {
  // Z_SYNC_FLUSH tolerates a file whose writer was killed before the gzip trailer.
  const raw = gunzipSync(readFileSync(path), { finishFlush: constants.Z_SYNC_FLUSH }).toString('utf8');
  return raw
    .split('\x03')
    .filter((part) => part.length > 0)
    .map((part) => JSON.parse(part) as unknown);
}

export function loadMotanLog(prefix: string): CaptureData {
  const index = readMessages(`${prefix}.index.gz`)[0] as { status: StatusTree; subscriptions?: Record<string, unknown> };
  const streams = new Map<string, unknown[]>();
  for (const msg of readMessages(`${prefix}.json.gz`)) {
    const m = msg as { q?: string; params?: unknown };
    if (typeof m.q !== 'string') continue;
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
