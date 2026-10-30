/** Subset of Spoolman's `Spool` (GET /api/v1/spool/{id}) the plugin uses. */
export interface Spool {
  id: number;
  remaining_weight?: number;
  used_weight?: number;
  remaining_length?: number;
  used_length?: number;
  archived?: boolean;
  location?: string;
  filament: {
    id: number;
    name?: string;
    material?: string;
    /** Hex without '#', e.g. "BD0B0B". */
    color_hex?: string;
    /** Net filament weight of a full spool, g. */
    weight?: number;
    vendor?: { id: number; name: string };
  };
}

/** What the plugin knows about one printer (see tracker.ts). */
export interface PrinterSpoolState {
  /** First load finished (successfully or not). */
  ready: boolean;
  /** Moonraker has the [spoolman] component configured. */
  hasSpoolman: boolean;
  /** Moonraker ↔ Spoolman connection; null = unknown yet. */
  connected: boolean | null;
  /** Klipper has [save_variables] — required for per-tool spools. */
  hasSaveVars: boolean;
  /** Tool names from `[gcode_macro T<n>]`, sorted: ["T0", "T1"]. Empty = single-tool printer. */
  tools: string[];
  /** Per-tool spool ids from save_variables `t<n>__spool_id`. */
  toolSpools: Record<string, number | null>;
  /** Moonraker's own active spool (server.spoolman.get_spool_id). */
  activeSpoolId: number | null;
  /** Current tool from save_variables `active_tool`, if the macros store it. */
  activeTool: string | null;
}

export function emptyPrinterState(): PrinterSpoolState {
  return {
    ready: false,
    hasSpoolman: false,
    connected: null,
    hasSaveVars: false,
    tools: [],
    toolSpools: {},
    activeSpoolId: null,
    activeTool: null,
  };
}
