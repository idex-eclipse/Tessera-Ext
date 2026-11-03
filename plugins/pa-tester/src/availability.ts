import { setApi } from './api-ref';
import { readPrinterConfig } from './printer-config';
import type { MpuParams, PluginApi } from './sdk';

/**
 * `available` export (manifest.json → extensions[].available).
 *
 * The host calls it before it shows our tab in `@core/calibrations#tabs`, with
 * OUR api and the point's params. The tab exists only on printers with a
 * `[pa_tester]` section. Without a load cell it is shown anyway, with an
 * explanation: hiding it would leave the user wondering where it went.
 *
 * The host caches the answer per printer and asks again after
 * `notify_klippy_ready`, `notify_config_changed` and a reconnect, i.e. after
 * the user adds `[pa_tester]` and restarts Klipper. Never throws.
 */
export async function hasPaTester(api: PluginApi, _params?: MpuParams): Promise<boolean> {
  setApi(api);
  try {
    return (await readPrinterConfig(api.moonraker())).hasPaTester;
  } catch {
    return false;
  }
}
