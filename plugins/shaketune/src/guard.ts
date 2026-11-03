import { getApi } from './api-ref';
import { ST_COMMAND_NAMES, scriptCommands } from './commands';
import type { GuardContext, GuardDecision } from './sdk';

/**
 * Guard `shaketune-safety` (manifest.json → guards), on `printer.gcode.script`.
 *
 * The host's GuardAgent calls it BEFORE any plugin's G-code reaches Moonraker:
 *
 *   handler(request, token, ctx) → { action: 'allow' | 'deny', reasonKey? }
 *
 * WHY a guard of our own: Calibrations has one (`calib-safety`) for vanilla
 * commands, but guards are not inherited and it does not know Shake&Tune's
 * names. Every Shake&Tune test moves the toolhead to the test point and shakes
 * the machine, so — exactly like SHAPER_CALIBRATE — it must not start:
 *   - while a print is running or paused (it would ruin the print);
 *   - with axes not homed (Klipper would refuse the move half-way).
 *
 * What it sees: commands from OTHER plugins (the console, macros widget, …).
 * The host skips a plugin's own guards for its own requests (anti-recursion),
 * so the Run button of our tab checks the same conditions itself (st-tab.ts).
 *
 * Decision rules (docs/en/guards.md):
 * - decide within 10 s, otherwise `guard_timeout` — hence STATE_TIMEOUT_MS;
 * - a throw counts as deny (fail-closed): we catch everything ourselves and
 *   ALLOW when the state is unknown (no api yet, printer offline). Klipper
 *   still rejects unhomed moves itself; we only add the "not while printing"
 *   rule it does not have.
 * - the decision is about `ctx.targetPrinterId`, which may not be the active
 *   printer (fleet actions) — hence `moonrakerFor`, not `moonraker()`.
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
}

async function queryState(printerId: string): Promise<PrinterState | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const handle = api.moonrakerFor(printerId);
    const res = await Promise.race([
      handle.request<{ status?: { print_stats?: { state?: string }; toolhead?: { homed_axes?: string } } }>(
        'printer.objects.query',
        { objects: { print_stats: ['state'], toolhead: ['homed_axes'] } },
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STATE_TIMEOUT_MS)),
    ]);
    if (!res) return null;
    return {
      printState: String(res.status?.print_stats?.state ?? ''),
      homedAxes: String(res.status?.toolhead?.homed_axes ?? ''),
    };
  } catch {
    return null;
  }
}

export async function guardShakeTune(
  request: GuardRequest,
  _token: string,
  ctx: GuardContext,
): Promise<GuardDecision> {
  if (request.method !== 'printer.gcode.script') return { action: 'allow' };

  const script = String((request.params as { script?: unknown } | undefined)?.script ?? '');
  if (!scriptCommands(script).some((c) => ST_COMMAND_NAMES.has(c))) return { action: 'allow' };

  const state = await queryState(ctx.targetPrinterId);
  if (!state) return { action: 'allow' };

  if (state.printState === 'printing' || state.printState === 'paused') {
    return { action: 'deny', reasonKey: 'shaketune.guard.printing' };
  }
  if (state.homedAxes !== 'xyz') {
    return { action: 'deny', reasonKey: 'shaketune.guard.homing' };
  }
  return { action: 'allow' };
}
