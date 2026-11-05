/**
 * Tasks, outcomes and the links between them form a directed graph: an edge goes from an
 * outcome of one task to a follow-up task it activates. This file validates the graph and
 * applies an outcome. It holds no UI, so the same code serves the card buttons now and
 * the visual chain editor later.
 */
import { newCounter } from './counters';
import type { JournalEntry, MaintenanceState, Task, Totals } from './types';

export interface GraphIssue {
  code: 'dangling' | 'cycle' | 'duplicate-id';
  /**
   * Errors make the graph unusable (an unknown id). A cycle is only a warning: a trigger
   * never fires another trigger by itself, every step waits for a person to press a button,
   * so two cards that trigger each other cannot loop. The editor still points it out.
   */
  severity: 'error' | 'warning';
  /** The task whose outcome holds the offending link (or the duplicated id). */
  taskId: string;
  outcomeId?: string;
  /** The target of the link, or the cycle path for `cycle`. */
  target?: string;
  path?: string[];
}

/**
 * Checks ids, link targets and cycles. A link may point at any task: a follow-up appears,
 * a timer task becomes due at once.
 */
export function validateGraph(state: Pick<MaintenanceState, 'tasks'>): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map<string, Task>();
  for (const t of state.tasks) {
    if (byId.has(t.id)) issues.push({ code: 'duplicate-id', severity: 'error', taskId: t.id });
    byId.set(t.id, t);
  }

  const edges = new Map<string, string[]>();
  for (const t of state.tasks) {
    const targets: string[] = [];
    for (const o of t.outcomes) {
      for (const target of o.activates) {
        const dest = byId.get(target);
        if (!dest) issues.push({ code: 'dangling', severity: 'error', taskId: t.id, outcomeId: o.id, target });
        else targets.push(target);
      }
    }
    edges.set(t.id, targets);
  }

  // Depth-first search; `onPath` holds the current chain, so meeting a task that is already
  // on it means a cycle (a self-link is a cycle of length one).
  const done = new Set<string>();
  const onPath: string[] = [];
  const visit = (id: string): void => {
    const at = onPath.indexOf(id);
    if (at !== -1) {
      issues.push({ code: 'cycle', severity: 'warning', taskId: id, path: [...onPath.slice(at), id] });
      return;
    }
    if (done.has(id)) return;
    onPath.push(id);
    for (const next of edges.get(id) ?? []) visit(next);
    onPath.pop();
    done.add(id);
  };
  for (const t of state.tasks) visit(t.id);
  return issues;
}

export interface ApplyResult {
  state: MaintenanceState;
  entry: JournalEntry;
  /** Tasks this outcome triggered (made due). */
  activated: string[];
}

/**
 * Presses a button on a card: restarts the timer and/or completes a follow-up, triggers
 * the linked tasks and produces the journal entry. Returns null for an unknown task
 * or outcome (the UI may hold a stale card).
 */
export function applyOutcome(
  state: MaintenanceState,
  taskId: string,
  outcomeId: string,
  totals: Totals,
  now: number,
  options: { note?: string; entryId: string; taskLabel: string },
): ApplyResult | null {
  const task = state.tasks.find((t) => t.id === taskId);
  const outcome = task?.outcomes.find((o) => o.id === outcomeId);
  if (!task || !outcome) return null;

  const activated: string[] = [];
  const tasks = state.tasks.map((t): Task => {
    let next = t;
    if (t.id === taskId) {
      // Restarting the timer also clears a trigger that made the task due.
      if (outcome.resetsTimer) {
        next = { ...next, counter: newCounter(totals, now), active: false, activatedAt: null, lastDone: now, notified: null };
      }
      if (outcome.completes) {
        next = { ...next, active: false, activatedAt: null, lastDone: now, notified: null };
      }
    }
    // A disabled task stays quiet (the user switched it off on purpose); an already
    // triggered one keeps its original trigger time. Checked on `next`, so a task whose own
    // outcome both resets it and links back to itself ends up triggered again.
    if (outcome.activates.includes(t.id) && t.kind !== 'precheck' && next.enabled && !next.active) {
      next = { ...next, active: true, activatedAt: now, notified: null };
      activated.push(t.id);
    }
    return next;
  });

  const entry: JournalEntry = {
    id: options.entryId,
    at: now,
    taskId,
    taskLabel: options.taskLabel,
    outcomeId,
    note: options.note?.trim() || undefined,
    totals: { ...totals },
  };
  return { state: { ...state, tasks }, entry, activated };
}

/** Journal entries newest first, capped (the whole journal lives in one settings record). */
export const JOURNAL_LIMIT = 200;

export function appendJournal(journal: JournalEntry[], entry: JournalEntry): JournalEntry[] {
  return [entry, ...journal].slice(0, JOURNAL_LIMIT);
}
