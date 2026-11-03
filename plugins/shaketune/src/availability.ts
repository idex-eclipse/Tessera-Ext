import { setApi } from './api-ref';
import { readPrinterConfig } from './printer-config';
import type { MpuParams, PluginApi } from './sdk';

/**
 * `available` export (manifest.json → extensions[].available).
 *
 * The host calls it before it shows our tab in the extension point
 * `@core/calibrations#shaper`, with OUR api and the point's params:
 *
 *   available(api, params) → boolean | Promise<boolean>
 *
 * The point is in `alternative` mode with `default: 'extension'`: while the
 * user has not chosen anything, the first AVAILABLE contribution replaces the
 * Klipper content of the tab. So this function is what makes Shake&Tune "on by
 * default when it is installed in Klipper" — and invisible on printers without
 * it (there the user gets the original tab and no alternative in the chooser).
 *
 * The host caches the answer per printer and asks again after
 * `notify_klippy_ready`, `notify_config_changed` and a reconnect — i.e. after
 * the user adds `[shaketune]` and restarts Klipper. While the promise is
 * pending the contribution counts as unavailable.
 *
 * Never throws: a rejected promise would also count as `false`, but the
 * explicit catch keeps the host console clean when Klipper is not ready.
 */
export async function hasShakeTune(api: PluginApi, _params?: MpuParams): Promise<boolean> {
  setApi(api);
  try {
    return (await readPrinterConfig(api.moonraker())).hasShakeTune;
  } catch {
    return false;
  }
}
