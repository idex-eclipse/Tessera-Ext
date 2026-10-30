import type { MoonrakerProxyHandle } from './sdk';
import type { Spool } from './types';

/**
 * Moonraker calls used by the plugin.
 *
 * Everything goes through the host's MoonrakerProxyHandle (`api.moonrakerFor`),
 * never through our own fetch/WebSocket:
 * - one shared connection per printer, auth token handled by the host;
 * - requests pass the host GuardAgent (other plugins' guards see ours);
 * - Spoolman itself is reached through Moonraker's `server.spoolman.proxy`,
 *   so the browser never talks to Spoolman directly: no CORS, no second URL
 *   to configure, works wherever Moonraker works.
 */

export class SpoolmanError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'SpoolmanError';
  }
}

interface ProxyV2<T> {
  response: T;
  error: { status_code: number; message: string } | null;
}

/**
 * GET/POST/… to Spoolman's REST API via Moonraker.
 *
 * `use_v2_response: true` makes Moonraker return `{ response, error }` instead
 * of passing Spoolman's HTTP status through as a JSON-RPC error, so a 404 for
 * a deleted spool is distinguishable from "Spoolman is down".
 */
export async function spoolmanProxy<T>(
  h: MoonrakerProxyHandle,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await h.request<ProxyV2<T>>('server.spoolman.proxy', {
    use_v2_response: true,
    request_method: method,
    path,
    ...(body !== undefined ? { body } : {}),
  });
  if (res?.error) throw new SpoolmanError(res.error.message, res.error.status_code ?? null);
  return res.response;
}

/** null when the spool does not exist any more (deleted in Spoolman). */
export async function fetchSpoolById(h: MoonrakerProxyHandle, id: number): Promise<Spool | null> {
  try {
    return await spoolmanProxy<Spool>(h, 'GET', `/v1/spool/${id}`);
  } catch (e) {
    if (e instanceof SpoolmanError && e.status === 404) return null;
    throw e;
  }
}

/** All non-archived spools (Spoolman excludes archived ones by default). */
export function fetchSpools(h: MoonrakerProxyHandle): Promise<Spool[]> {
  return spoolmanProxy<Spool[]>(h, 'GET', '/v1/spool');
}

export async function getActiveSpoolId(h: MoonrakerProxyHandle): Promise<number | null> {
  const res = await h.request<{ spool_id: number | null }>('server.spoolman.get_spool_id');
  const id = Number(res?.spool_id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Moonraker reports filament usage to this spool from now on. */
export function setActiveSpoolId(h: MoonrakerProxyHandle, id: number | null): Promise<unknown> {
  return h.request('server.spoolman.post_spool_id', { spool_id: id });
}

export async function getSpoolmanConnected(h: MoonrakerProxyHandle): Promise<boolean> {
  const res = await h.request<{ spoolman_connected?: boolean }>('server.spoolman.status');
  return res?.spoolman_connected === true;
}

/** `[spoolman] server:` from moonraker.conf (for the iframe page). */
export async function getSpoolmanServer(h: MoonrakerProxyHandle): Promise<string | undefined> {
  const res = await h.request<{ config?: { spoolman?: { server?: string } } }>('server.config');
  return res?.config?.spoolman?.server;
}

/**
 * Persists the tool → spool mapping in Klipper's save_variables.
 *
 * SAVE_VARIABLE writes the value to Klipper's variables file and updates
 * `printer.save_variables.variables`, so every client (and our own
 * subscription in tracker.ts) sees the change. The value must be a Python
 * literal: a plain integer is fine.
 */
export function saveToolSpool(h: MoonrakerProxyHandle, tool: string, id: number | null): Promise<unknown> {
  const variable = `${tool.toLowerCase()}__spool_id`;
  return h.request('printer.gcode.script', {
    script: `SAVE_VARIABLE VARIABLE=${variable} VALUE=${id ?? 'None'}`,
  });
}

export function getFileMetadata(h: MoonrakerProxyHandle, filename: string): Promise<unknown> {
  return h.request('server.files.metadata', { filename });
}
