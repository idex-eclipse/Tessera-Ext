import type { PrinterSpoolState } from './types';

/**
 * Pure helpers for Klipper/Moonraker data. No api, no DOM — unit-tested.
 *
 * Per-tool spool convention (shared with Tessera's core "tools" widget):
 *   - a tool is a `[gcode_macro T<n>]`;
 *   - its spool id is stored by Klipper in `[save_variables]` as `t<n>__spool_id`;
 *   - the tool-change macro tells Moonraker which spool is active now
 *     (SET_ACTIVE_SPOOL ID=...), so Moonraker reports usage to the right spool.
 * Keeping the mapping in Klipper (not in browser settings) means every client
 * and every browser sees the same assignment, and it survives reloads.
 */

/** "T0".."Tn" from `printer.objects.list`, numerically sorted. */
export function toolsFromObjects(objects: readonly string[]): string[] {
  return objects
    .filter((o) => o.startsWith('gcode_macro '))
    .map((o) => o.slice('gcode_macro '.length))
    .filter((m) => /^T\d+$/i.test(m))
    .map((m) => m.toUpperCase())
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function positiveInt(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** `t<n>__spool_id` for every tool; missing/0/garbage → null. */
export function toolSpoolsFromVariables(
  variables: Record<string, unknown>,
  tools: readonly string[],
): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const tool of tools) out[tool] = positiveInt(variables[`${tool.toLowerCase()}__spool_id`]);
  return out;
}

/** `active_tool` saved by tool-change macros (number or "T1"). */
export function activeToolFromVariables(variables: Record<string, unknown>): string | null {
  const raw = variables.active_tool;
  if (raw == null || raw === '') return null;
  const m = /^T?(\d+)$/i.exec(String(raw).trim());
  return m ? `T${Number(m[1])}` : null;
}

/** Tool names to show/check: a printer without T<n> macros has one implicit tool. */
export function effectiveTools(state: PrinterSpoolState): string[] {
  return state.tools.length > 0 ? state.tools : ['T0'];
}

/**
 * Spool loaded in `tool`:
 * 1. the per-tool assignment from save_variables;
 * 2. on a single-tool printer — Moonraker's active spool (works without
 *    save_variables and without any macros).
 */
export function spoolIdForTool(state: PrinterSpoolState, tool: string): number | null {
  const fromVars = state.toolSpools[tool];
  if (fromVars != null) return fromVars;
  if (state.tools.length <= 1) return state.activeSpoolId;
  return null;
}

/**
 * Spoolman web UI address for the iframe.
 *
 * Moonraker's `[spoolman] server:` is usually written from Moonraker's point
 * of view (http://localhost:7912). The browser runs elsewhere, so a loopback
 * host is replaced with the printer's host. A URL the user typed in the page
 * settings always wins.
 */
export function resolveSpoolmanUrl(
  configured: string | undefined,
  moonrakerServer: string | undefined,
  printerUrl: string,
): string | null {
  const manual = configured?.trim();
  if (manual) return manual;

  const server = moonrakerServer?.trim();
  if (!server) return null;
  try {
    const url = new URL(server);
    if (['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname)) {
      // printer.url may be "192.168.1.5", "http://pi.local:7125", or empty
      // (UI served by the printer itself → use the page host).
      let host = '';
      try {
        host = new URL(/^[a-z]+:\/\//i.test(printerUrl) ? printerUrl : `http://${printerUrl}`).hostname;
      } catch {
        host = '';
      }
      url.hostname = host || (typeof location !== 'undefined' ? location.hostname : url.hostname);
    }
    return url.href;
  } catch {
    return null;
  }
}
