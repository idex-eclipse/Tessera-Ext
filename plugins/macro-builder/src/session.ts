import type { PluginApi } from '@tessera/sdk';

/** The Config action passes this narrow, one-use contract instead of its editor or file API. */
export interface BuilderSession {
  printerId: string;
  path: string;
  revision: number;
  cursor: number;
  section: { name: string; from: number; to: number; firstLine: number; lastLine: number; text: string } | null;
  createAt: number;
  macroNames: string[];
  commands: Array<{ name: string; params: string[] }>;
  objects: string[];
  suggest?: (value: string, cursor: number, variables: readonly { name: string; value: string }[], macroName: string) => Array<{
    label: string; insert: string; kind: string; detail?: string; from: number;
  }>;
  applyEdit: (replacement: string) => 'applied' | 'stale' | 'closed';
}

/** Runtime check protects the overlay if another extension invokes the action incorrectly. */
export function isBuilderSession(value: unknown): value is BuilderSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<BuilderSession>;
  return typeof session.printerId === 'string' && typeof session.path === 'string' &&
    typeof session.applyEdit === 'function' && Array.isArray(session.macroNames) &&
    Array.isArray(session.commands) && Array.isArray(session.objects);
}

export type BuilderApi = Pick<PluginApi, 'i18n' | 'theme' | 'onThemeChange'>;
