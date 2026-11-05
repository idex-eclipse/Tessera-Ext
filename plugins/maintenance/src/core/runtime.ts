/**
 * The live side of the plugin for ONE printer: it loads the saved state, follows the
 * Moonraker totals and the running print, keeps the evaluation up to date and saves every
 * change through `api.settings`.
 *
 * It is plain TypeScript with injected dependencies (no Lit, no host imports), so it can be
 * tested with fakes. The UI elements only render it and call its actions; the notification
 * monitor and the pre-print guard (stage 3) read the same object.
 */
import { parseRunning, parseTotals, syncCounter, ZERO_TOTALS } from './counters';
import { createDefaultState, newCustomTask, syncTools } from './defaults';
import { evaluateAll } from './evaluate';
import { addLink, removeLink, type Edge, type LinkError, type Point } from './chains';
import { applyOutcome, appendJournal } from './graph';
import { applyAnswers, skipOnboarding } from './presets';
import type { SettingsLike } from './storage';
import type { NotifyTrigger } from './notify';
import { readJournal, readState, stateKey, journalKey, watchPrinter, writeJournal, writeState } from './storage';
import type {
  JournalEntry,
  MaintenanceSettings,
  MaintenanceState,
  RunningUsage,
  Task,
  TaskEvaluation,
  Totals,
  WizardAnswers,
} from './types';

/** The slice of the host's MoonrakerProxyHandle the runtime uses. */
export interface MoonrakerLike {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  subscribe(objects: Record<string, string[]>, callback: (delta: unknown) => void, options?: { immediate?: boolean }): () => void;
  onNotify(event: string, callback: (params: unknown) => void): () => void;
  onReady(callback: () => void): () => void;
}

export interface RuntimeDeps {
  printerId: string;
  settings: SettingsLike;
  moonraker: MoonrakerLike;
  now?: () => number;
  genId?: () => string;
  /** Re-evaluation period for the "days" unit; tests pass 0 to disable the timer. */
  tickMs?: number;
}

/** Extruder objects look like `extruder`, `extruder1`, … */
export function toolsFromObjectList(response: unknown): string[] {
  const objects = (response as { objects?: unknown } | null | undefined)?.objects;
  if (!Array.isArray(objects)) return [];
  return objects.filter((o): o is string => typeof o === 'string' && /^extruder\d*$/.test(o));
}

export class MaintenanceRuntime {
  readonly printerId: string;
  state: MaintenanceState | null = null;
  journal: JournalEntry[] = [];
  totals: Totals | null = null;
  running: RunningUsage = { ...ZERO_TOTALS };
  tools: string[] = [];
  evals: TaskEvaluation[] = [];

  readonly #d: RuntimeDeps;
  readonly #subs = new Set<() => void>();
  readonly #eventSubs = new Set<(trigger: NotifyTrigger) => void>();
  #startEmitted = false;
  #lastPrintState = '';
  #offs: Array<() => void> = [];
  #timer: ReturnType<typeof setInterval> | null = null;
  #started = false;
  /** JSON of what this runtime wrote last, to ignore the echo of its own write. */
  #lastWritten = new Map<string, string>();
  #printStats: Record<string, unknown> = {};

  constructor(deps: RuntimeDeps) {
    this.#d = deps;
    this.printerId = deps.printerId;
  }

  get #now(): number {
    return (this.#d.now ?? Date.now)();
  }

  /** Subscribes to every change (state, totals, the clock tick). */
  subscribe(cb: () => void): () => void {
    this.#subs.add(cb);
    return () => this.#subs.delete(cb);
  }

  #emit(): void {
    for (const cb of this.#subs) cb();
  }

  /**
   * Subscribes to the moments when reminders should be evaluated: the first load (`start`),
   * a changed history (`history`), a finished print (`printEnd`) and the clock (`timer`).
   * The notification monitor is the only consumer; the UI uses {@link subscribe}.
   */
  onEvent(cb: (trigger: NotifyTrigger) => void): () => void {
    this.#eventSubs.add(cb);
    return () => this.#eventSubs.delete(cb);
  }

  #fire(trigger: NotifyTrigger): void {
    for (const cb of this.#eventSubs) cb(trigger);
  }

  /** Re-evaluates with the current clock (the guard calls this right before it decides). */
  reevaluate(): void {
    this.#recompute();
  }

  /** Idempotent: loads the data and starts following the printer. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    const { settings, moonraker } = this.#d;

    this.#offs.push(watchPrinter(settings, this.printerId, () => this.#reloadFromSettings()));
    this.#offs.push(moonraker.subscribe({ print_stats: ['state', 'print_duration', 'filament_used'] }, (delta) => this.#onPrintStats(delta), { immediate: true }));
    this.#offs.push(moonraker.onNotify('notify_history_changed', () => void this.refreshTotals().then(() => this.#fire('history'))));
    // After a reconnect everything may have changed while we were away.
    this.#offs.push(moonraker.onReady(() => void this.#bootstrap()));

    const tick = this.#d.tickMs ?? 60_000;
    if (tick > 0) {
      this.#timer = setInterval(() => {
        this.#recompute();
        this.#fire('timer');
      }, tick);
    }

    this.#reloadFromSettings(false);
    void this.#bootstrap();
  }

  stop(): void {
    for (const off of this.#offs) off();
    this.#offs = [];
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    this.#started = false;
  }

  async #bootstrap(): Promise<void> {
    try {
      const list = await this.#d.moonraker.request('printer.objects.list');
      const tools = toolsFromObjectList(list);
      if (tools.length > 0) this.tools = tools;
    } catch {
      // Not connected yet: the tool list stays as it was and onReady will retry.
    }
    await this.refreshTotals();
  }

  /** Reads `server.history.totals` and brings the counters up to date. */
  async refreshTotals(): Promise<void> {
    let parsed: Totals | null = null;
    try {
      parsed = parseTotals(await this.#d.moonraker.request('server.history.totals'));
    } catch {
      parsed = null;
    }
    // A failed read keeps the last totals: treating it as zero would look like a reset.
    if (!parsed) return;
    this.totals = parsed;
    this.#adopt();
  }

  #onPrintStats(delta: unknown): void {
    const ps = (delta as { print_stats?: Record<string, unknown> } | null | undefined)?.print_stats ?? (delta as Record<string, unknown> | null);
    if (!ps || typeof ps !== 'object') return;
    this.#printStats = { ...this.#printStats, ...ps };
    this.running = parseRunning(this.#printStats);
    this.#recompute();

    // A print that just ended: refresh the totals first (the job is in the history by now or
    // about to be), then let the monitor repeat an overdue reminder.
    const state = typeof this.#printStats.state === 'string' ? this.#printStats.state : '';
    const wasActive = this.#lastPrintState === 'printing' || this.#lastPrintState === 'paused';
    const ended = state === 'complete' || state === 'cancelled' || state === 'error';
    this.#lastPrintState = state || this.#lastPrintState;
    if (wasActive && ended) void this.refreshTotals().then(() => this.#fire('printEnd'));
  }

  /** Creates the state on first run, adds tasks for new extruders, syncs the counters. */
  #adopt(): void {
    const totals = this.totals;
    if (!totals) return;
    const now = this.#now;

    let state = this.state;
    let dirty = false;
    if (!state) {
      // The baseline is the totals at THIS moment, so the state must be saved right away;
      // otherwise every reload would start counting from zero again.
      state = createDefaultState(this.tools, totals, now);
      dirty = true;
    } else if (this.tools.length > 0) {
      const grown = syncTools(state, this.tools, totals, now);
      if (grown !== state) {
        state = grown;
        dirty = true;
      }
    }

    // History totals can be reset by the user: move the consumed part into `carry`.
    const synced = state.tasks.map((t) => {
      const counter = syncCounter(t.counter, totals);
      return counter === t.counter ? t : { ...t, counter };
    });
    if (synced.some((t, i) => t !== state!.tasks[i])) {
      state = { ...state, tasks: synced };
      dirty = true;
    }

    if (dirty) this.#save(state);
    else this.#recompute();

    if (!this.#startEmitted) {
      this.#startEmitted = true;
      this.#fire('start');
    }
  }

  #save(state: MaintenanceState): void {
    this.state = state;
    this.#lastWritten.set(stateKey(this.printerId), JSON.stringify(state));
    writeState(this.#d.settings, this.printerId, state);
    this.#recompute();
  }

  #saveJournal(journal: JournalEntry[]): void {
    this.journal = journal;
    this.#lastWritten.set(journalKey(this.printerId), JSON.stringify(journal));
    writeJournal(this.#d.settings, this.printerId, journal);
  }

  /** Picks up changes made by another browser (the host pulled them from the Moonraker DB). */
  #reloadFromSettings(emit = true): void {
    const rawState = readState(this.#d.settings, this.printerId);
    const same = rawState !== null && JSON.stringify(rawState) === this.#lastWritten.get(stateKey(this.printerId));
    if (!same && rawState) this.state = rawState;
    const journal = readJournal(this.#d.settings, this.printerId);
    if (JSON.stringify(journal) !== this.#lastWritten.get(journalKey(this.printerId))) this.journal = journal;
    if (emit) this.#recompute();
    else this.#recomputeQuiet();
  }

  #recomputeQuiet(): void {
    this.evals = this.state && this.totals ? evaluateAll(this.state, this.totals, this.running, this.#now) : [];
  }

  #recompute(): void {
    this.#recomputeQuiet();
    this.#emit();
  }

  // ----- actions ------------------------------------------------------------

  /** Applies a change to the state and saves it. Does nothing before the first load. */
  mutate(fn: (s: MaintenanceState) => MaintenanceState): void {
    if (!this.state) return;
    const next = fn(this.state);
    if (next !== this.state) this.#save(next);
  }

  /** Presses an outcome button of a card. Returns the tasks it triggered. */
  press(taskId: string, outcomeId: string, note: string | undefined, taskLabel: string): string[] {
    if (!this.state || !this.totals) return [];
    const result = applyOutcome(this.state, taskId, outcomeId, this.totals, this.#now, {
      note,
      entryId: this.#d.genId ? this.#d.genId() : `${this.#now}-${Math.random().toString(36).slice(2, 8)}`,
      taskLabel,
    });
    if (!result) return [];
    this.#save(result.state);
    this.#saveJournal(appendJournal(this.journal, result.entry));
    return result.activated;
  }

  /**
   * Writes a journal line that does not belong to a card (for example "print started with
   * overdue tasks"). `outcomeId` names an i18n key under `maintenance.journalEvent`.
   */
  logEvent(taskLabel: string, outcomeId: string, note?: string): void {
    const entry: JournalEntry = {
      id: this.#d.genId ? this.#d.genId() : `${this.#now}-${Math.random().toString(36).slice(2, 8)}`,
      at: this.#now,
      taskId: '',
      taskLabel,
      outcomeId,
      note: note?.trim() || undefined,
      totals: this.totals ? { ...this.totals } : null,
    };
    this.#saveJournal(appendJournal(this.journal, entry));
    this.#emit();
  }

  /** Edits a task; the edit pins it, so the wizard will not overwrite it later. */
  updateTask(id: string, patch: (t: Task) => Task): void {
    this.mutate((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === id ? { ...patch(t), customized: true } : t)) }));
  }

  addCustomTask(name: string, kind: 'interval' | 'followup'): string | null {
    if (!this.state || !this.totals) return null;
    const id = `custom:${this.#d.genId ? this.#d.genId() : Math.random().toString(36).slice(2, 10)}`;
    const task = newCustomTask(id, name, kind, this.totals, this.#now);
    this.mutate((s) => ({ ...s, tasks: [...s.tasks, task] }));
    return id;
  }

  /** Removes a custom task and every link that pointed at it. */
  deleteTask(id: string): void {
    this.mutate((s) => {
      const target = s.tasks.find((t) => t.id === id);
      if (!target || target.defId !== 'custom') return s;
      return {
        ...s,
        tasks: s.tasks
          .filter((t) => t.id !== id)
          .map((t) => ({ ...t, outcomes: t.outcomes.map((o) => ({ ...o, activates: o.activates.filter((a) => a !== id) })) })),
      };
    });
  }

  /** Adds a link "outcome of `from` makes `to` due". Returns why it was refused, or null. */
  linkOutcome(from: string, outcome: string, to: string): LinkError | null {
    if (!this.state) return 'unknown-task';
    const r = addLink(this.state, from, outcome, to);
    if ('error' in r) return r.error;
    this.#save(r.state);
    return null;
  }

  unlinkOutcome(edge: Edge): void {
    this.mutate((s) => removeLink(s, edge));
  }

  /** Saves card positions of the chain editor (`null` forgets them: back to the automatic layout). */
  setLayout(layout: Record<string, Point> | null): void {
    this.mutate((s) => {
      if (layout === null) {
        if (!s.layout) return s;
        const { layout: _dropped, ...rest } = s;
        return rest;
      }
      return { ...s, layout };
    });
  }

  updateSettings(patch: Partial<MaintenanceSettings>): void {
    this.mutate((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  }

  finishWizard(answers: WizardAnswers): void {
    this.mutate((s) => applyAnswers(s, answers));
  }

  skipWizard(): void {
    this.mutate((s) => skipOnboarding(s));
  }
}
