/**
 * Reading moonraker-obico.cfg and what follows from it.
 *
 * The agent keeps everything we need in its own config file in the Klipper config folder
 * (`<printer_data>/config/moonraker-obico.cfg`): the Obico server it talks to, whether it is
 * linked (an `auth_token` is written there by the link step), where it logs and where its
 * tunnel leads. Reading the file through Moonraker works the same for Obico Cloud and a
 * self-hosted server and needs no access to the Obico API.
 *
 * Pure functions only: they are unit-tested without a printer.
 */

/** Sections of an INI file: section name → key → value. Section and key names are lower case. */
export type Ini = Record<string, Record<string, string>>;

/** What the plugin needs from moonraker-obico.cfg. The auth token itself is never kept. */
export interface ObicoConfig {
  /** Obico server URL without a trailing slash, e.g. `https://app.obico.io`. */
  serverUrl: string;
  /** Obico Cloud (app.obico.io) rather than a self-hosted server. */
  isCloud: boolean;
  /** The link step wrote an auth token: the agent is linked to a printer on the server. */
  hasToken: boolean;
  /** Log file as configured (absolute path on the printer host), '' when not set. */
  logPath: string;
  /** Where the Obico tunnel forwards requests on the printer host. */
  tunnel: { host: string; port: number; ssl: boolean };
}

/** Defaults of moonraker-obico (moonraker_obico/config.py) for keys missing from the file. */
const DEFAULT_SERVER = 'https://app.obico.io';
const DEFAULT_TUNNEL_HOST = '127.0.0.1';
const DEFAULT_TUNNEL_PORT = 80;

/**
 * A minimal parser for the Python `configparser` dialect the agent writes: `[section]`,
 * `key = value` or `key: value`, whole-line comments with `#` or `;`. Names are lower-cased
 * like configparser does; multi-line values are not used by moonraker-obico and are ignored.
 */
export function parseIni(text: string): Ini {
  const ini: Ini = {};
  let section: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const head = /^\[([^\]]+)\]$/.exec(line);
    if (head) {
      const name = head[1]!.trim().toLowerCase();
      section = ini[name] ??= {};
      continue;
    }
    if (!section) continue;
    const eq = line.search(/[=:]/);
    if (eq <= 0) continue;
    section[line.slice(0, eq).trim().toLowerCase()] = line.slice(eq + 1).trim();
  }
  return ini;
}

/** configparser's boolean words; anything else falls back like the agent does. */
function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.toLowerCase();
  if (['1', 'yes', 'true', 'on'].includes(v)) return true;
  if (['0', 'no', 'false', 'off'].includes(v)) return false;
  return fallback;
}

/** True for Obico Cloud: the cloud API has no personal tokens, so some features stay self-hosted. */
export function isCloudUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'obico.io' || host.endsWith('.obico.io');
  } catch {
    return false;
  }
}

/** Interprets the parsed file with the agent's own defaults. */
export function readObicoConfig(ini: Ini): ObicoConfig {
  const server = ini['server'] ?? {};
  const tunnel = ini['tunnel'] ?? {};
  const serverUrl = (server['url'] || DEFAULT_SERVER).replace(/\/+$/, '');
  const port = Number.parseInt(tunnel['dest_port'] ?? '', 10);
  return {
    serverUrl,
    isCloud: isCloudUrl(serverUrl),
    hasToken: Boolean(server['auth_token']),
    logPath: ini['logging']?.['path'] ?? '',
    tunnel: {
      host: tunnel['dest_host'] || DEFAULT_TUNNEL_HOST,
      port: Number.isFinite(port) && port > 0 ? port : DEFAULT_TUNNEL_PORT,
      ssl: parseBool(tunnel['dest_is_ssl'], false),
    },
  };
}

/**
 * The page of this printer in the Obico web app (obico-server app/urls.py:
 * `printers/<pk>/control/`), or the printer list when the id is unknown.
 */
export function obicoPrinterUrl(serverUrl: string, printerId: number | null): string {
  return printerId === null ? `${serverUrl}/printers/` : `${serverUrl}/printers/${printerId}/control/`;
}

/** A file under one of Moonraker's roots, as its file API addresses it. */
export interface MoonrakerFileRef {
  root: 'logs' | 'config';
  path: string;
}

/** The agent's log when `[logging] path` is not set: the installer writes it there. */
export const DEFAULT_LOG: MoonrakerFileRef = { root: 'logs', path: 'moonraker-obico.log' };

/**
 * Maps an absolute log path on the printer host to a Moonraker root, so the browser can
 * read it through `/server/files/<root>/<path>`. Moonraker does not tell the data folder
 * name, so the usual layouts are matched: `printer_data` and KIAUH's `printer_<n>_data`.
 * Returns null for a path outside them (Moonraker would not serve it anyway).
 */
export function logFileRef(logPath: string): MoonrakerFileRef | null {
  if (!logPath) return DEFAULT_LOG;
  const m = /\/[^/]*_data\/(logs|config)\/(.+)$/.exec(logPath.replace(/\\/g, '/'));
  if (!m) return null;
  return { root: m[1] as MoonrakerFileRef['root'], path: m[2]! };
}

/**
 * The port the tunnel should lead to so that remote access opens Tessera: the port this
 * page was loaded from. Null when the page itself came over HTTPS (Tessera's HTTPS site or
 * the Obico tunnel): the tunnel needs Tessera's plain HTTP port, which the page cannot know.
 */
export function tesseraPort(location: Pick<Location, 'protocol' | 'port'>): number | null {
  if (location.protocol !== 'http:') return null;
  const port = Number.parseInt(location.port, 10);
  return Number.isFinite(port) && port > 0 ? port : 80;
}

/** The `[tunnel]` lines the user pastes into moonraker-obico.cfg to reach Tessera. */
export function tunnelSnippet(port: number): string {
  return `[tunnel]\ndest_host = 127.0.0.1\ndest_port = ${port}\ndest_is_ssl = False`;
}
