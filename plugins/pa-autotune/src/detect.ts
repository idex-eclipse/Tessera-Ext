import { PROVIDERS, type ProviderId } from './providers';
import type { MoonrakerProxyHandle } from './sdk';

/**
 * Which providers are installed on the printer.
 *
 * Primary signal: the provider's command in `printer.gcode.help` — it exists
 * as soon as Klipper has loaded the extra, whether or not the extra publishes
 * a status object. Secondary: the object in `printer.objects.list`. The web UI
 * itself is not looked at here: it lives on nginx, outside Moonraker (see url.ts).
 */

export interface Detection {
  installed: ProviderId[];
  /** `[load_cell]` / `[load_cell_probe]` is configured (both providers need one). */
  hasLoadCell: boolean;
  /** Klipper could not be asked (not ready, offline): the result is unknown, not "nothing installed". */
  unknown: boolean;
}

const LOAD_CELL_OBJECT = /^load_cell(_probe)?(\s|$)/i;

/** Providers whose command is among the keys of `gcode/help`. */
export function detectFromHelp(help: Record<string, unknown> | null | undefined): ProviderId[] {
  const names = new Set(Object.keys(help ?? {}).map((k) => k.toUpperCase()));
  return PROVIDERS.filter((p) => names.has(p.detectCommand)).map((p) => p.id);
}

/** Providers and the load cell among `objects/list`. */
export function detectFromObjects(objects: readonly string[] | null | undefined): {
  installed: ProviderId[];
  hasLoadCell: boolean;
} {
  const list = objects ?? [];
  const lower = new Set(list.map((o) => o.toLowerCase()));
  return {
    installed: PROVIDERS.filter((p) => lower.has(p.objectName)).map((p) => p.id),
    hasLoadCell: list.some((o) => LOAD_CELL_OBJECT.test(o)),
  };
}

/** Never throws: a failure of one query leaves the other one to answer. */
export async function detectProviders(handle: MoonrakerProxyHandle): Promise<Detection> {
  const [help, objects] = await Promise.allSettled([
    handle.request<Record<string, unknown>>('printer.gcode.help'),
    handle.request<{ objects?: string[] }>('printer.objects.list'),
  ]);

  const fromHelp = help.status === 'fulfilled' ? detectFromHelp(help.value) : [];
  const fromObjects =
    objects.status === 'fulfilled'
      ? detectFromObjects(objects.value?.objects)
      : { installed: [] as ProviderId[], hasLoadCell: false };

  const found = new Set<ProviderId>([...fromHelp, ...fromObjects.installed]);
  return {
    installed: PROVIDERS.filter((p) => found.has(p.id)).map((p) => p.id),
    hasLoadCell: fromObjects.hasLoadCell,
    unknown: help.status === 'rejected' && objects.status === 'rejected',
  };
}
