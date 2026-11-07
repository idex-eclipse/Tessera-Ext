import type { MoonrakerProxyHandle } from '../sdk';
import { type MoonrakerFileRef, type ObicoConfig, parseIni, readObicoConfig } from './config';

/**
 * What the tab knows about moonraker-obico on one printer, gathered through Moonraker only.
 *
 * Sources, all optional (any of them may be missing on a given install):
 * - `machine.system_info`: the systemd service, if Moonraker is allowed to manage it
 *   (the installer adds it to `moonraker.asvc`; a Docker install has no service at all);
 * - `moonraker-obico.cfg` in the config root: server, link token, log, tunnel;
 * - Moonraker DB `obico/printer_id`: written by the agent once it is linked;
 * - Klipper macros from `moonraker_obico_macros.cfg` (included by the installer):
 *   `OBICO_LINK_STATUS` carries the one-time link code, `_OBICO_RELINK` asks the agent
 *   to forget its token and link again.
 */
export interface ObicoSnapshot {
  /** The first load has not finished yet. */
  loading: boolean;
  /** Any trace of the agent on this printer: config, service or macros. */
  installed: boolean;
  /** Parsed moonraker-obico.cfg, null when the file is absent or unreadable. */
  config: ObicoConfig | null;
  /** Id of this printer on the Obico server (Moonraker DB), null when unknown. */
  printerId: number | null;
  /** The systemd service, null when Moonraker does not list it. */
  service: ServiceInfo | null;
  /** Link state. `linked` is null when nothing tells it (no macro and no config). */
  link: LinkInfo;
  /** `_OBICO_RELINK` exists, so the agent can be re-linked from here. */
  canRelink: boolean;
}

export interface ServiceInfo {
  name: string;
  /** systemd `active_state` / `sub_state`, e.g. `active` / `running`. */
  active: string;
  sub: string;
}

export interface LinkInfo {
  linked: boolean | null;
  /** One-time code to type in the Obico app, '' when none is issued. */
  passcode: string;
  /** Link that opens the Obico app with the code filled in, '' when none. */
  passlink: string;
}

const LINK_MACRO = 'gcode_macro OBICO_LINK_STATUS';
const RELINK_MACRO = 'gcode_macro _OBICO_RELINK';
/** The config file name the installer uses, in Moonraker's `config` root. */
export const CONFIG_FILE = 'moonraker-obico.cfg';

/** Service names of moonraker-obico: `moonraker-obico`, or `moonraker-obico-<suffix>` for extra printers. */
export function findObicoService(names: Iterable<string>): string | null {
  for (const n of names) if (/^moonraker-obico(?:[-_.].*)?$/i.test(n)) return n;
  return null;
}

/** Shape of the `machine.system_info` answer we read (loosely typed: it is protocol data). */
interface SystemInfoReply {
  system_info?: {
    available_services?: unknown;
    service_state?: Record<string, { active_state?: string; sub_state?: string }>;
  };
}

/** Picks the agent's service out of `machine.system_info`. */
export function serviceFromSystemInfo(reply: SystemInfoReply | null): ServiceInfo | null {
  const info = reply?.system_info;
  if (!info) return null;
  const states = info.service_state ?? {};
  const listed = Array.isArray(info.available_services) ? info.available_services.filter((s): s is string => typeof s === 'string') : [];
  const name = findObicoService([...listed, ...Object.keys(states)]);
  if (!name) return null;
  const st = states[name] ?? {};
  return { name, active: st.active_state ?? '', sub: st.sub_state ?? '' };
}

/**
 * Link state from the macro variables when the macro exists, otherwise from the token in
 * the config. The macro is the live source: the agent updates it while it waits for a code.
 */
export function linkInfo(macro: Record<string, unknown> | null, config: ObicoConfig | null): LinkInfo {
  if (macro) {
    return {
      linked: macro['is_linked'] === true,
      passcode: typeof macro['one_time_passcode'] === 'string' ? macro['one_time_passcode'] : '',
      passlink: typeof macro['one_time_passlink'] === 'string' ? macro['one_time_passlink'] : '',
    };
  }
  return { linked: config ? config.hasToken : null, passcode: '', passlink: '' };
}

/**
 * Reads the agent's config through Moonraker's file endpoint (plain HTTP: the JSON-RPC
 * proxy has no "read file" call). Authorization is the host's Bearer token, null when
 * Moonraker needs no login. Returns null when the file does not exist.
 */
export async function fetchConfigText(handle: MoonrakerProxyHandle): Promise<string | null> {
  const res = await fetch(`${handle.httpBaseUrl}/server/files/config/${CONFIG_FILE}`, {
    headers: authHeaders(handle),
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** How much of the end of the log the tab shows: enough for the last restart, small for a Pi. */
export const LOG_TAIL_BYTES = 64 * 1024;

/**
 * The end of the agent's log. A `Range` request keeps a long log from being downloaded
 * whole; a server that ignores Range answers 200 with the full file, which is cut here.
 * The first line is dropped when it may be cut in the middle.
 */
export async function fetchLogTail(handle: MoonrakerProxyHandle, ref: MoonrakerFileRef): Promise<string | null> {
  const rel = ref.path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${handle.httpBaseUrl}/server/files/${ref.root}/${rel}`, {
    headers: { ...authHeaders(handle), Range: `bytes=-${LOG_TAIL_BYTES}` },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  // 416: the file is empty, there is no range to return.
  if (res.status === 416) return '';
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  // A 206 starting past byte 0 (`Content-Range: bytes <start>-<end>/<size>`) begins mid-line.
  const start = Number(/bytes (\d+)-/.exec(res.headers.get('Content-Range') ?? '')?.[1] ?? 0);
  const cut = res.status === 206 ? start > 0 : text.length > LOG_TAIL_BYTES;
  if (!cut) return text;
  const tail = text.slice(-LOG_TAIL_BYTES);
  const nl = tail.indexOf('\n');
  return nl >= 0 ? tail.slice(nl + 1) : tail;
}

/** The Bearer header the host itself uses for Moonraker HTTP calls. */
export function authHeaders(handle: MoonrakerProxyHandle): Record<string, string> {
  return handle.authToken ? { Authorization: `Bearer ${handle.authToken}` } : {};
}

/**
 * Live model of one printer. Created by the tab for the active printer and disposed when
 * the tab goes away or the printer changes; listeners re-render on every change.
 */
export class ObicoState {
  snapshot: ObicoSnapshot = {
    loading: true,
    installed: false,
    config: null,
    printerId: null,
    service: null,
    link: { linked: null, passcode: '', passlink: '' },
    canRelink: false,
  };

  #handle: MoonrakerProxyHandle;
  #listeners = new Set<() => void>();
  #off: Array<() => void> = [];
  #unsubMacro: (() => void) | null = null;
  #macro: Record<string, unknown> | null = null;
  #hasMacro = false;
  #disposed = false;
  /** Bumped by every load, so an older answer that arrives late is dropped. */
  #generation = 0;

  constructor(handle: MoonrakerProxyHandle) {
    this.#handle = handle;
    // The service starts, stops or crashes: only system_info changes.
    this.#off.push(handle.onNotify('notify_service_state_changed', () => void this.#loadService()));
    // Klipper restarted (macros may have appeared after an [include]) or Moonraker reconnected.
    this.#off.push(handle.onNotify('notify_klippy_ready', () => void this.reload()));
    this.#off.push(handle.onReady(() => void this.reload()));
    void this.reload();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#disposed = true;
    this.#unsubMacro?.();
    for (const off of this.#off) off();
    this.#off = [];
    this.#listeners.clear();
  }

  /** Reads everything again. Each source fails on its own: a missing one is just "not there". */
  async reload(): Promise<void> {
    const gen = ++this.#generation;
    const h = this.#handle;
    const [sys, objects, cfgText, dbId] = await Promise.all([
      h.request<SystemInfoReply>('machine.system_info').catch(() => null),
      h.request<{ objects?: string[] }>('printer.objects.list').catch(() => null),
      fetchConfigText(h).catch(() => null),
      h.request<{ value?: unknown }>('server.database.get_item', { namespace: 'obico', key: 'printer_id' }).catch(() => null),
    ]);
    if (this.#disposed || gen !== this.#generation) return;

    const list = objects?.objects ?? [];
    const config = cfgText === null ? null : readObicoConfig(parseIni(cfgText));
    const id = Number(dbId?.value);
    this.#hasMacro = list.includes(LINK_MACRO);
    this.#bindMacro();
    this.#set({
      loading: false,
      config,
      printerId: Number.isInteger(id) && id > 0 ? id : null,
      service: serviceFromSystemInfo(sys),
      canRelink: list.includes(RELINK_MACRO),
    });
  }

  /** Restarts the agent's service (Moonraker refuses services missing from moonraker.asvc). */
  async restartService(): Promise<void> {
    const name = this.snapshot.service?.name;
    if (!name) return;
    await this.#handle.request('machine.services.restart', { service: name });
  }

  /** Runs the agent's own re-link macro: it drops the token and restarts the service. */
  async relink(): Promise<void> {
    await this.#handle.request('printer.gcode.script', { script: '_OBICO_RELINK' });
  }

  async #loadService(): Promise<void> {
    const sys = await this.#handle.request<SystemInfoReply>('machine.system_info').catch(() => null);
    if (!this.#disposed) this.#set({ service: serviceFromSystemInfo(sys) });
  }

  /** Subscribes to the link macro once it exists; its variables change while a code is issued. */
  #bindMacro(): void {
    if (!this.#hasMacro || this.#unsubMacro) return;
    this.#unsubMacro = this.#handle.subscribe(
      { [LINK_MACRO]: ['is_linked', 'one_time_passcode', 'one_time_passlink'] },
      (delta: Record<string, Record<string, unknown> | undefined>) => {
        const part = delta?.[LINK_MACRO];
        if (!part) return;
        // Subscriptions deliver changes only: merge them into our copy.
        this.#macro = { ...this.#macro, ...part };
        this.#set({});
      },
      { immediate: true },
    );
  }

  #set(patch: Partial<ObicoSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    // Until the first macro values arrive, the config's token is the better guess.
    next.link = linkInfo(this.#hasMacro ? this.#macro : null, next.config);
    next.installed = next.config !== null || next.service !== null || this.#hasMacro;
    this.snapshot = next;
    for (const l of this.#listeners) l();
  }
}
