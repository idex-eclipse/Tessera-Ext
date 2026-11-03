import { RESULT_FOLDERS, type ResultFolder } from './commands';
import type { MoonrakerProxyHandle } from './sdk';

/**
 * Shake&Tune graphs on the printer.
 *
 * Shake&Tune writes them to `[shaketune] result_folder`, by default
 * `~/printer_data/config/ShakeTune_results`, one subfolder per graph type:
 *
 *   input_shaper/inputshaper_20260116_101500_axis_X.png
 *   belts/beltscomparison_20260116_101500.png
 *   vibrations/vibrationsprofile_….png   axes_map/axesmap_….png   static_freq/…
 *
 * next to `.stdata` raw data (kept only with `keep_raw_data: True`) and
 * temporary `snt_tmp-<hex>.stdata` files of a run in progress. It keeps the
 * last `number_of_results_to_keep` PNGs per folder.
 *
 * The browser reaches those files only through Moonraker, and Moonraker serves
 * only its registered roots — normally `config` = ~/printer_data/config. So the
 * plugin maps result_folder onto the `config` root; a folder outside it cannot
 * be listed (resolveResultsPath returns null and the UI says so).
 */

export const DEFAULT_RESULT_FOLDER = '~/printer_data/config/ShakeTune_results';

/**
 * `result_folder` → path inside Moonraker's `config` root, or null.
 * Klipper keeps the option as written (`~` is expanded only by Shake&Tune), so
 * both `~/printer_data/config/X` and `/home/pi/printer_data/config/X` occur.
 */
export function resolveResultsPath(resultFolder: string | null | undefined): string | null {
  const folder = (resultFolder || DEFAULT_RESULT_FOLDER).replace(/\\/g, '/').replace(/\/+$/, '');
  const m = /(?:^|\/)(?:printer_data\/config|klipper_config)\/(.+)$/.exec(folder);
  return m ? m[1]! : null;
}

export interface ResultFile {
  /** Path inside the `config` root: `ShakeTune_results/input_shaper/….png`. */
  path: string;
  folder: ResultFolder;
  name: string;
  /** Unix seconds (Moonraker `modified`). */
  modified: number;
  /** Axis of an input shaper graph (`…_axis_X.png`), otherwise null. */
  axis: 'X' | 'Y' | null;
}

interface DirectoryResponse {
  files?: Array<{ filename?: string; modified?: number }>;
}

/** Only finished graphs: no raw data, no temporary files of a running test. */
export function isGraph(filename: string): boolean {
  return /\.png$/i.test(filename) && !filename.startsWith('snt_tmp');
}

export function graphAxis(filename: string): 'X' | 'Y' | null {
  const m = /_axis_([XY])\.png$/i.exec(filename);
  return m ? (m[1]!.toUpperCase() as 'X' | 'Y') : null;
}

/**
 * All graphs, newest first. A missing subfolder is not an error: Shake&Tune
 * creates them on klippy:connect, older versions have no static_freq/, and a
 * printer may simply never have run that test.
 *
 * `server.files.get_directory` (not `server.files.list`: that one lists a whole
 * root recursively and has no `path` parameter). The host proxy caches it for
 * 10 s and drops the cache on `notify_filelist_changed`, which Shake&Tune
 * triggers by writing the PNG — so a refresh after that event is fresh.
 */
export async function listResults(handle: MoonrakerProxyHandle, base: string): Promise<ResultFile[]> {
  const lists = await Promise.all(
    RESULT_FOLDERS.map(async (folder) => {
      try {
        const res = await handle.request<DirectoryResponse>('server.files.get_directory', {
          path: `config/${base}/${folder}`,
          extended: false,
        });
        return (res?.files ?? [])
          .filter((f) => typeof f.filename === 'string' && isGraph(f.filename))
          .map<ResultFile>((f) => ({
            path: `${base}/${folder}/${f.filename}`,
            folder,
            name: f.filename!,
            modified: Number(f.modified ?? 0),
            axis: graphAxis(f.filename!),
          }));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat().sort((a, b) => b.modified - a.modified);
}

/**
 * A graph as an object URL (revoke it when it is no longer shown).
 *
 * Plain HTTP to Moonraker's file endpoint, not the JSON-RPC proxy: binary data
 * does not go through the WebSocket. Authorization is the same Bearer token the
 * host uses (`handle.authToken`, null when Moonraker needs no login).
 * `no-store`: file names repeat after Shake&Tune's cleanup cycles, a cached
 * image could be a different run.
 */
export async function loadImage(handle: MoonrakerProxyHandle, path: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (handle.authToken) headers.Authorization = `Bearer ${handle.authToken}`;
  const rel = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${handle.httpBaseUrl}/server/files/config/${rel}`, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}
