import { getApi } from './api-ref';
import { PA_COMMAND_NAMES, scriptCommands } from './commands';
import type { GuardContext, GuardDecision } from './sdk';

/**
 * Guard `pa-tester-safety` (manifest.json → guards), on `printer.gcode.script`.
 *
 * Both commands extrude at high flow and push the filament against the load
 * cell, so they must not start:
 *   - while a print is running or paused;
 *   - with axes not homed;
 *   - with a cold extruder (`min_extrude_temp`): the module fails with
 *     "Extruder cannot extrude" only after it has prepared the run.
 *
 * What it sees: commands of OTHER plugins (console, macros, …). The host skips
 * a plugin's own guards for its own requests, so the Run button checks the same
 * conditions itself (ui/pa-tab.ts).
 *
 * Decision rules (docs/en/guards.md): decide within 10 s; a throw is a deny, so
 * everything is caught and an unknown state is ALLOWED (Klipper still rejects
 * what it cannot do). The decision is about `ctx.targetPrinterId`.
 */

const STATE_TIMEOUT_MS = 3_000;

interface GuardRequest {
  method: string;
  params: unknown;
  targetPrinterId: string;
}

interface PrinterState {
  printState: string;
  homedAxes: string;
  /** null — unknown (no value in the config / no temperature). */
  cold: boolean | null;
}

type QueryResult = { status?: Record<string, Record<string, unknown> | undefined> };

async function queryState(printerId: string): Promise<PrinterState | null> {
  const api = getApi();
  if (!api) return null;
  const handle = api.moonrakerFor(printerId);
  try {
    const run = async (): Promise<PrinterState> => {
      const base = await handle.request<QueryResult>('printer.objects.query', {
        objects: { print_stats: ['state'], toolhead: ['homed_axes', 'extruder'], configfile: ['settings'] },
      });
      const status = base?.status ?? {};
      const extruder = String(status.toolhead?.extruder ?? '');
      let cold: boolean | null = null;
      if (extruder) {
        const settings = (status.configfile?.settings ?? {}) as Record<string, { min_extrude_temp?: unknown } | undefined>;
        const min = Number(settings[extruder]?.min_extrude_temp);
        const hot = await handle.request<QueryResult>('printer.objects.query', {
          objects: { [extruder]: ['temperature'] },
        });
        const temp = hot?.status?.[extruder]?.temperature;
        if (Number.isFinite(min) && typeof temp === 'number') cold = temp < min;
      }
      return {
        printState: String(status.print_stats?.state ?? ''),
        homedAxes: String(status.toolhead?.homed_axes ?? ''),
        cold,
      };
    };
    return await Promise.race([
      run(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STATE_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

export async function guardPaTester(
  request: GuardRequest,
  _token: string,
  ctx: GuardContext,
): Promise<GuardDecision> {
  if (request.method !== 'printer.gcode.script') return { action: 'allow' };

  const script = String((request.params as { script?: unknown } | undefined)?.script ?? '');
  if (!scriptCommands(script).some((c) => PA_COMMAND_NAMES.has(c))) return { action: 'allow' };

  const state = await queryState(ctx.targetPrinterId);
  if (!state) return { action: 'allow' };

  if (state.printState === 'printing' || state.printState === 'paused') {
    return { action: 'deny', reasonKey: 'patester.guard.printing' };
  }
  if (state.homedAxes !== 'xyz') {
    return { action: 'deny', reasonKey: 'patester.guard.homing' };
  }
  if (state.cold === true) {
    return { action: 'deny', reasonKey: 'patester.guard.cold' };
  }
  return { action: 'allow' };
}
