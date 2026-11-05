/**
 * Reading and writing the plugin's data through the host's `api.settings`.
 *
 * The host mirrors plugin settings into the Moonraker database of the printer (see the
 * host's docs/en/settings.md), so this file has no code of its own for persistence,
 * conflicts or offline work. It only owns the key names and the format version.
 *
 * Keys carry the printer id: with the plugin's "sync" switch on (Settings → Plugins) the
 * host stores ONE shared object for all printers, and per-printer keys keep their data
 * apart in that case too.
 */
import type { JournalEntry, MaintenanceState } from './types';
import { STATE_VERSION } from './types';

/** The part of the host's PluginSettingsApi the plugin needs (kept narrow for tests). */
export interface SettingsLike {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  onChange(callback: (key: string, value: unknown) => void): () => void;
}

export const stateKey = (printerId: string): string => `printer:${printerId}:state`;
export const journalKey = (printerId: string): string => `printer:${printerId}:journal`;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * A value read back from storage is only trusted when it has the shape of the current
 * format. Anything else (a newer plugin version wrote it, a hand edit, a half-synced copy)
 * gives null and the caller starts from the defaults instead of crashing on it.
 */
export function readState(settings: SettingsLike, printerId: string): MaintenanceState | null {
  const raw = settings.get<unknown>(stateKey(printerId));
  if (!isRecord(raw) || raw.v !== STATE_VERSION) return null;
  if (!Array.isArray(raw.tasks) || !isRecord(raw.settings) || !isRecord(raw.onboarding)) return null;
  const tasks = raw.tasks.filter(
    (t) => isRecord(t) && typeof t.id === 'string' && typeof t.defId === 'string' && Array.isArray(t.outcomes) && isRecord(t.counter),
  );
  return { ...(raw as unknown as MaintenanceState), tasks: tasks as unknown as MaintenanceState['tasks'] };
}

export function writeState(settings: SettingsLike, printerId: string, state: MaintenanceState): void {
  settings.set(stateKey(printerId), state);
}

export function readJournal(settings: SettingsLike, printerId: string): JournalEntry[] {
  const raw = settings.get<unknown>(journalKey(printerId));
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is JournalEntry => isRecord(e) && typeof e.id === 'string' && typeof e.at === 'number');
}

export function writeJournal(settings: SettingsLike, printerId: string, journal: JournalEntry[]): void {
  settings.set(journalKey(printerId), journal);
}

/** Calls back when this printer's state or journal changed (also from another browser). */
export function watchPrinter(settings: SettingsLike, printerId: string, cb: () => void): () => void {
  return settings.onChange((key) => {
    // The host reports '' when the whole object was replaced (a pull from the Moonraker DB).
    if (key === '' || key === stateKey(printerId) || key === journalKey(printerId)) cb();
  });
}
