import { getApi } from './api-ref';
import { GUARDED_COMMANDS, scriptCommands } from './providers';
import type { GuardContext, GuardDecision } from './sdk';

/**
 * Guard `pa-autotune-safety` (manifest.json → guards), on `printer.gcode.script`.
 *
 * AUTOPA_SWEEP, AUTOPA_DECAY and KAPAT_SWEEP heat the nozzle, move the head and
 * push filament against the load cell, so they must not start while a print is
 * running or paused. Homing and temperature are NOT checked: both modules take
 * `TARGET_TEMP` / their own settings and may home and heat by themselves, so a
 * refusal here would block a valid run.
 *
 * What it sees: commands of OTHER plugins (the Tessera console, macros, …).
 * Sweeps started from the provider's own web UI (our iframe) go straight to
 * Moonraker and bypass every Tessera guard — see the README.
 *
 * Decision rules (docs/en/guards.md): decide within 10 s; a throw is a deny, so
 * everything is caught and an unknown state is ALLOWED (Klipper still rejects
 * what it cannot do). The decision is about `ctx.targetPrinterId`. Deny only:
 * there is no confirmation step in this version.
 */

const STATE_TIMEOUT_MS = 3_000;

interface GuardRequest {
  method: string;
  params: unknown;
  targetPrinterId: string;
}

type QueryResult = { status?: { print_stats?: { state?: unknown } } };

/** `print_stats.state` of the printer, or null when it cannot be read in time. */
async function queryPrintState(printerId: string): Promise<string | null> {
  const api = getApi();
  if (!api) return null;
  try {
    const run = async (): Promise<string> => {
      const res = await api.moonrakerFor(printerId).request<QueryResult>('printer.objects.query', {
        objects: { print_stats: ['state'] },
      });
      return String(res?.status?.print_stats?.state ?? '');
    };
    return await Promise.race([
      run(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), STATE_TIMEOUT_MS)),
    ]);
  } catch {
    return null;
  }
}

export async function guardPaAutotune(
  request: GuardRequest,
  _token: string,
  ctx: GuardContext,
): Promise<GuardDecision> {
  if (request.method !== 'printer.gcode.script') return { action: 'allow' };

  const script = String((request.params as { script?: unknown } | undefined)?.script ?? '');
  if (!scriptCommands(script).some((c) => GUARDED_COMMANDS.has(c))) return { action: 'allow' };

  const state = await queryPrintState(ctx.targetPrinterId);
  if (state === 'printing' || state === 'paused') {
    return { action: 'deny', reasonKey: 'paautotune.guard.printing' };
  }
  return { action: 'allow' };
}
