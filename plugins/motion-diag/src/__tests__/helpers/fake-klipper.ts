/**
 * A Klipper stand-in for tests: serves the cartesian fixture capture through the bridge
 * calls (klippyRequest / klippyStream), acknowledges subscriptions, and replays the
 * fixture's messages on demand.
 */
import { resolve } from 'node:path';
import { vi } from 'vitest';

import { buildSources, type DataSource } from '../../core/discovery';
import type { CaptureData } from '../../core/types';
import type { KlippyStreamStatus } from '../../sdk';
import { loadMotanLog } from './motan-log';

// Under happy-dom `import.meta.url` is not a file URL, so the path is built from the working
// directory (vitest runs from the plugin folder).
export const fixture: CaptureData = loadMotanLog(resolve(process.cwd(), 'src/__tests__/fixtures/cartesian/log'));

interface Sub {
  method: string;
  params: Record<string, unknown>;
  onData: (d: unknown) => void;
  onStatus?: (s: KlippyStreamStatus) => void;
  onAck?: (r: unknown) => void;
  cancelled: boolean;
}

/** A Klipper stand-in that serves `fixture`: requests, acks, and messages on demand. */
export function fakeKlipper(opts: { state?: string; rejectKeys?: string[] } = {}) {
  const subs: Sub[] = [];
  const sources = buildSources(fixture.initialStatus);
  const sourceOf = (s: Sub): DataSource | undefined =>
    sources.find((src) => src.method === s.method && src.paramVariants.some((v) => JSON.stringify(v) === JSON.stringify(s.params)));

  const handle = {
    klippyRequest: vi.fn(async (method: string) => {
      if (method === 'info') return { state: opts.state ?? 'ready' };
      if (method === 'objects/list') return { objects: Object.keys(fixture.initialStatus) };
      if (method === 'objects/query') return { status: fixture.initialStatus };
      throw new Error(`unexpected ${method}`);
    }),
    klippyStream: vi.fn(
      (
        method: string,
        params: Record<string, unknown>,
        onData: (d: unknown) => void,
        onStatus?: (s: KlippyStreamStatus) => void,
        onAck?: (r: unknown) => void,
      ) => {
        const sub: Sub = { method, params, onData, onStatus, onAck, cancelled: false };
        subs.push(sub);
        queueMicrotask(() => {
          if (sub.cancelled) return;
          if (Object.keys(params).some((k) => opts.rejectKeys?.includes(k))) {
            onStatus?.('unavailable');
            return;
          }
          onStatus?.('live');
          onAck?.(method === 'objects/subscribe' ? { eventtime: 100, status: fixture.initialStatus } : { header: [] });
        });
        return () => {
          sub.cancelled = true;
        };
      },
    ),
  };

  /** Delivers the fixture's messages to every live subscription. */
  function replay(): void {
    for (const sub of subs) {
      if (sub.cancelled) continue;
      const id = sub.method === 'objects/subscribe' ? 'status' : sourceOf(sub)?.id;
      for (const msg of fixture.streams.get(id ?? '') ?? []) sub.onData(msg);
    }
  }
  return { handle, subs, replay, sources };
}

export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

