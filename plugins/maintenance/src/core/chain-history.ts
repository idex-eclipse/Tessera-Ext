/**
 * Undo / redo for the chain editor.
 *
 * Same idea as the dashboard editor of the host (host/src/core/layout-editor.svelte.ts): keep
 * snapshots of what the editor changes, push the previous one on every change, and move
 * between them on undo and redo. The snapshot covers ONLY what the editor edits, the links
 * and the card positions. Everything else in the state (counters, journal, intervals) is left
 * alone on purpose: pressing Undo must never take back a "Done" the user pressed meanwhile.
 */
import type { Point } from './chains';
import type { MaintenanceState } from './types';

export interface ChainSnapshot {
  /** task id -> result id -> ids of the tasks that result makes due. */
  links: Record<string, Record<string, string[]>>;
  /** Card positions; absent while the automatic layout is in use. */
  layout?: Record<string, Point>;
}

export function snapshotOf(state: Pick<MaintenanceState, 'tasks' | 'layout'>): ChainSnapshot {
  const links: ChainSnapshot['links'] = {};
  for (const t of state.tasks) {
    links[t.id] = Object.fromEntries(t.outcomes.map((o) => [o.id, [...o.activates]]));
  }
  return state.layout ? { links, layout: structuredClone(state.layout) } : { links };
}

/**
 * Puts a snapshot back. Tasks and results that exist now but not in the snapshot (created
 * later) keep their current links; links to tasks that have been deleted since are dropped.
 */
export function applySnapshot(state: MaintenanceState, snap: ChainSnapshot): MaintenanceState {
  const ids = new Set(state.tasks.map((t) => t.id));
  const tasks = state.tasks.map((t) => {
    const saved = snap.links[t.id];
    if (!saved) return t;
    return {
      ...t,
      outcomes: t.outcomes.map((o) => {
        const wanted = saved[o.id];
        return wanted ? { ...o, activates: wanted.filter((id) => ids.has(id)) } : o;
      }),
    };
  });
  const { layout: _old, ...rest } = state;
  return snap.layout ? { ...rest, tasks, layout: structuredClone(snap.layout) } : { ...rest, tasks };
}

const same = (a: ChainSnapshot, b: ChainSnapshot): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Oldest steps are forgotten beyond this many. */
export const HISTORY_LIMIT = 100;

export class ChainHistory {
  #past: ChainSnapshot[] = [];
  #future: ChainSnapshot[] = [];
  #current: ChainSnapshot | null = null;

  get canUndo(): boolean {
    return this.#past.length > 0;
  }

  get canRedo(): boolean {
    return this.#future.length > 0;
  }

  /** Starts a session from the state as it is now. */
  reset(state: MaintenanceState | null): void {
    this.#past = [];
    this.#future = [];
    this.#current = state ? snapshotOf(state) : null;
  }

  /**
   * Tells the history that the state may have changed. A real change puts the previous
   * snapshot on the undo stack and empties the redo stack. Returns true if it was recorded.
   */
  changed(state: MaintenanceState): boolean {
    const next = snapshotOf(state);
    if (!this.#current) {
      this.#current = next;
      return false;
    }
    if (same(next, this.#current)) return false;
    this.#past.push(this.#current);
    if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
    this.#future = [];
    this.#current = next;
    return true;
  }

  /** The snapshot to restore for Undo, or null. The caller applies it, then calls {@link applied}. */
  undo(): ChainSnapshot | null {
    const prev = this.#past.pop();
    if (!prev || !this.#current) return null;
    this.#future.push(this.#current);
    this.#current = prev;
    return prev;
  }

  redo(): ChainSnapshot | null {
    const next = this.#future.pop();
    if (!next || !this.#current) return null;
    this.#past.push(this.#current);
    this.#current = next;
    return next;
  }
}
