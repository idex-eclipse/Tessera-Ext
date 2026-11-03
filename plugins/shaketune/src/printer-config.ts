import { accelChips } from './commands';
import { resolveResultsPath } from './results';
import type { MoonrakerProxyHandle } from './sdk';

/**
 * What the plugin needs from the printer's Klipper config.
 *
 * One `printer.objects.query { configfile: ['settings'] }` answers all of it:
 * - `settings.shaketune` exists ⇔ the `[shaketune]` section is configured.
 *   Shake&Tune is a Klipper extras module without get_status(), so it does
 *   NOT appear in `printer.objects.list`; the config section is the reliable
 *   signal. (`settings` also contains the defaults of options the user did not
 *   write, e.g. result_folder.)
 * - `settings.printer.kinematics` — belts / vibrations tests support only some.
 * - accelerometer sections — the ACCEL_CHIP choices.
 *
 * `printer.objects.query` is not cached by the host proxy (only file listings,
 * history and `printer.configfile.*` are), so callers ask once per mount and
 * again on `notify_klippy_ready` / `notify_config_changed`, not per render.
 */
export interface PrinterConfig {
  hasShakeTune: boolean;
  /** Results folder inside the `config` root, null when it is outside of it. */
  resultsPath: string | null;
  kinematics: string;
  chips: string[];
}

type Settings = Record<string, Record<string, unknown> | undefined>;

export function configFromSettings(settings: Settings): PrinterConfig {
  const st = settings.shaketune;
  return {
    hasShakeTune: st !== undefined,
    resultsPath: resolveResultsPath(typeof st?.result_folder === 'string' ? st.result_folder : null),
    kinematics: String(settings.printer?.kinematics ?? '').toLowerCase(),
    chips: accelChips(Object.keys(settings)),
  };
}

export async function readPrinterConfig(handle: MoonrakerProxyHandle): Promise<PrinterConfig> {
  const res = await handle.request<{ status?: { configfile?: { settings?: Settings } } }>(
    'printer.objects.query',
    { objects: { configfile: ['settings'] } },
  );
  return configFromSettings(res?.status?.configfile?.settings ?? {});
}
