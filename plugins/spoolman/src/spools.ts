import { signal } from '@preact/signals';

import { apiRef } from './api-ref';
import { fetchSpoolById } from './moonraker';
import type { Spool } from './types';

/**
 * Spool cache keyed by `${printerId}:${spoolId}`.
 *
 * The key includes the printer because every Moonraker may point at a
 * different Spoolman instance: spool #3 on one printer is not spool #3 on
 * another. Values: Spool, or null = "does not exist" (deleted in Spoolman).
 */
export const spoolCache = signal<Record<string, Spool | null>>({});

const TTL_MS = 60_000;
const fetchedAt = new Map<string, number>();
const inflight = new Map<string, Promise<Spool | null>>();

const keyOf = (printerId: string, id: number) => `${printerId}:${id}`;

/** Fetches (deduplicated) and caches one spool. Rejects if Spoolman is unreachable. */
export function loadSpool(printerId: string, id: number, force = false): Promise<Spool | null> {
  const key = keyOf(printerId, id);
  const pending = inflight.get(key);
  if (pending) return pending;

  const cached = spoolCache.peek()[key];
  if (!force && cached !== undefined && Date.now() - (fetchedAt.get(key) ?? 0) < TTL_MS) {
    return Promise.resolve(cached);
  }

  const api = apiRef.peek();
  if (!api) return Promise.resolve(null);

  const p = fetchSpoolById(api.moonrakerFor(printerId), id)
    .then((spool) => {
      spoolCache.value = { ...spoolCache.peek(), [key]: spool };
      fetchedAt.set(key, Date.now());
      return spool;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * Reactive read for components: returns what is cached (undefined while
 * loading) and refreshes in the background when the entry is stale.
 */
export function useSpool(printerId: string, id: number | null): Spool | null | undefined {
  if (id == null) return null;
  const key = keyOf(printerId, id);
  const value = spoolCache.value[key]; // subscribes the component to the cache
  if (value === undefined || Date.now() - (fetchedAt.get(key) ?? 0) >= TTL_MS) {
    loadSpool(printerId, id).catch((e) => console.warn(`[spoolman] spool ${id}:`, e));
  }
  return value;
}

/** Forget cached spools (after a manual refresh or a spool assignment). */
export function invalidateSpools(printerId: string): void {
  for (const key of Array.from(fetchedAt.keys())) {
    if (key.startsWith(`${printerId}:`)) fetchedAt.delete(key);
  }
}
