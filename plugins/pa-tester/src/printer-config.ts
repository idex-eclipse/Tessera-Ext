import type { MoonrakerProxyHandle } from './sdk';

/**
 * What the plugin needs from the printer's Klipper config.
 *
 * One `printer.objects.query { configfile: ['settings'] }` answers all of it.
 * `settings.pa_tester` exists ⇔ the `[pa_tester]` section is configured: that
 * is the signal for the tab (the module has get_status(), but the config
 * section is there from the start). Option values of the section (with
 * defaults) become the placeholders of the form.
 *
 * `printer.objects.query` is not cached by the host proxy, so callers ask once
 * per mount and again on `notify_klippy_ready` / `notify_config_changed`.
 */

export interface LoadCellInfo {
  /** Config section, e.g. `load_cell`, `load_cell foo`, `load_cell_probe`. */
  section: string;
  /** Name for the `load_cell/dump_force` webhook (`sensor` param, `load_cell` on older Klipper). */
  name: string;
}

export interface PrinterConfig {
  hasPaTester: boolean;
  /** `[pa_tester]` options as the printer reports them (strings). */
  options: Record<string, string>;
  loadCells: LoadCellInfo[];
  extruders: string[];
}

type Settings = Record<string, Record<string, unknown> | undefined>;

const LOAD_CELL_SECTION = /^load_cell(_probe)?(\s|$)/i;
const EXTRUDER_SECTION = /^extruder\d*$/i;

/**
 * Webhook name of a load cell: the last word of its section, as Klipper
 * registers `load_cell/dump_force` by the config name (`[load_cell]` →
 * `load_cell`, `[load_cell foo]` → `foo`). To be confirmed on hardware for
 * `load_cell_probe`; the user can pick another section in the form.
 */
export function loadCellName(section: string): string {
  const words = section.trim().split(/\s+/);
  return words[words.length - 1]!;
}

export function configFromSettings(settings: Settings): PrinterConfig {
  const pa = settings.pa_tester;
  const options: Record<string, string> = {};
  for (const [k, v] of Object.entries(pa ?? {})) {
    if (v !== null && v !== undefined && v !== '') options[k] = String(v);
  }
  const keys = Object.keys(settings);
  return {
    hasPaTester: pa !== undefined,
    options,
    loadCells: keys
      .filter((k) => LOAD_CELL_SECTION.test(k))
      .map((section) => ({ section, name: loadCellName(section) })),
    extruders: keys.filter((k) => EXTRUDER_SECTION.test(k)),
  };
}

/**
 * The load cell the module will use: the user's pick from the form, else
 * `force_sensor` of `[pa_tester]`, else the only one (the module auto-detects
 * exactly one; several is an error until `FORCE_SENSOR=` is given).
 */
export function pickLoadCell(config: PrinterConfig, choice = ''): LoadCellInfo | null {
  const wanted = choice || config.options.force_sensor || '';
  if (wanted) {
    return (
      config.loadCells.find((c) => c.section === wanted || c.name === wanted) ?? {
        section: wanted,
        name: loadCellName(wanted),
      }
    );
  }
  return config.loadCells.length === 1 ? config.loadCells[0]! : null;
}

export async function readPrinterConfig(handle: MoonrakerProxyHandle): Promise<PrinterConfig> {
  const res = await handle.request<{ status?: { configfile?: { settings?: Settings } } }>(
    'printer.objects.query',
    { objects: { configfile: ['settings'] } },
  );
  return configFromSettings(res?.status?.configfile?.settings ?? {});
}
