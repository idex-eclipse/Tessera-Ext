/**
 * One MaintenanceRuntime per printer, shared by every element of the plugin.
 *
 * The host mounts and unmounts the tab and the widget as the user navigates, but the
 * counters, the saved state and the (stage 3) reminder monitor must outlive that, so the
 * runtimes live at module level and are created on first use.
 */
import { MaintenanceRuntime, type MoonrakerLike } from './core/runtime';
import type { PluginApi } from './sdk';

const runtimes = new Map<string, MaintenanceRuntime>();

/** The runtime of a printer if one was already created; never creates one. */
export function peekRuntime(printerId: string): MaintenanceRuntime | undefined {
  return runtimes.get(printerId);
}

export function runtimeFor(api: PluginApi, printerId: string): MaintenanceRuntime {
  let rt = runtimes.get(printerId);
  if (!rt) {
    rt = new MaintenanceRuntime({
      printerId,
      settings: api.settingsFor(printerId),
      moonraker: api.moonrakerFor(printerId) as unknown as MoonrakerLike,
    });
    runtimes.set(printerId, rt);
  }
  rt.start();
  return rt;
}

/** For tests: stop and forget every runtime. */
export function resetHub(): void {
  for (const rt of runtimes.values()) rt.stop();
  runtimes.clear();
}
