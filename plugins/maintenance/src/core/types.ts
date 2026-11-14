/**
 * Data model of the maintenance plugin.
 *
 * Everything here is plain JSON: the whole state is stored through the host's
 * `api.settingsFor`, which mirrors it into the Moonraker database. Keep it small (one record
 * per printer) and versioned (`MaintenanceState.v`).
 *
 * The model is a graph: a TASK has OUTCOMES (the buttons on its card), and an outcome can
 * ACTIVATE other tasks. "Belts: adjusted" activating "Shaper calibration" is just data, so
 * the built-in chains and the user's own chains work the same way.
 */

/** Interval units. A task is due when ANY of its set units is reached. */
export interface Intervals {
  /** Print hours (Moonraker `total_print_time`). */
  hours?: number;
  /** Number of prints (Moonraker `total_jobs`; it also counts cancelled and failed jobs). */
  prints?: number;
  /** Calendar days since the last reset. */
  days?: number;
  /** Kilometres of filament (Moonraker `total_filament_used`, millimetres, ÷ 1e6). */
  filamentKm?: number;
}

export type Unit = keyof Intervals;

/** All units, in the order the UI shows them. */
export const UNITS: readonly Unit[] = ['hours', 'prints', 'days', 'filamentKm'];

/** Printer-wide totals as Moonraker keeps them. */
export interface Totals {
  /** Seconds of printing. */
  printSeconds: number;
  jobs: number;
  /** Millimetres. */
  filamentMm: number;
}

/** What the running print has used so far (it is not in the history totals yet). */
export type RunningUsage = Totals;

/**
 * How much of the totals a task has consumed.
 *
 * `baseline` is the totals at the last reset; `carry` is what was used before the History
 * page reset its totals (the totals dropped, so the baseline was moved and the consumed
 * part was banked here); `adjust` is the user's manual correction (a tool-specific nozzle
 * has no counter of its own, see README).
 */
export interface Counter {
  baseline: Totals;
  /** Baseline time, ms since epoch; the "days" unit counts from here. */
  since: number;
  carry: Totals;
  /** Manual correction, in the units of {@link Intervals}. */
  adjust: Intervals;
  /** Totals seen on the previous sync, to detect a reset in History. */
  lastSeen: Totals | null;
}

export type TaskKind =
  /** Due by its intervals. */
  | 'interval'
  /** Has no timer: exists only while an outcome of another task has activated it. */
  | 'followup'
  /** Shown in the pre-print dialog at every print start (the bed check). */
  | 'precheck';

/** A button on a task card. */
export interface Outcome {
  id: string;
  /** i18n key for built-in outcomes. */
  labelKey?: string;
  /** Text for user-made outcomes. */
  label?: string;
  /** Restart the task's timer. */
  resetsTimer: boolean;
  /** For a follow-up task: finish it (it disappears until activated again). */
  completes?: boolean;
  /**
   * Tasks (by id) this outcome triggers. ANY task can be a target: a follow-up appears, a
   * timer task becomes due right away (its timer is treated as run out) until its own
   * timer is reset.
   */
  activates: string[];
}

/** Where a task card can send the user for the actual work. */
export interface TaskLink {
  /** A tab of the Calibrations page. */
  calibrations?: 'shaper' | 'belts' | 'probe' | 'heaters' | 'mesh';
}

export type NotifyLevel = 'soon' | 'overdue';

export interface Task {
  id: string;
  /** Built-in definition id (`nozzle`), or `custom`. */
  defId: string;
  kind: TaskKind;
  /** Name for custom tasks; built-in tasks are named through i18n by `defId`. */
  name?: string;
  /** Instruction text for custom tasks. */
  instruction?: string;
  /** Tool/extruder (`extruder`, `extruder1`) for per-tool tasks. */
  tool?: string;
  enabled: boolean;
  /**
   * Triggered by an outcome of another task. A follow-up is due while this is set; an
   * interval task is due immediately, whatever its timer says, until an outcome resets it.
   */
  active: boolean;
  /** The user edited this task, so the wizard must not overwrite it. */
  customized: boolean;
  intervals: Intervals;
  /** Start reminding this long before the due point; unset units use the default. */
  lead: Intervals;
  /** Take part in the pre-print dialog. */
  guard: boolean;
  /** Send notifications for this task. */
  notify: boolean;
  outcomes: Outcome[];
  counter: Counter;
  link?: TaskLink;
  /** Extra data a preset keeps for the card text (e.g. the rail type per axis). */
  details?: Record<string, string>;
  lastDone: number | null;
  /** When the task was triggered. */
  activatedAt: number | null;
  /** The last notification level sent for the current cycle. */
  notified: { level: NotifyLevel; at: number } | null;
}

export type RailType = 'ball-liquid' | 'ball-grease' | 'carbon' | 'none';
export type NozzleType = 'brass' | 'hardened' | 'custom';
export type FeederType = 'regular' | 'planetary';
export type WashHabit = 'glue-stick' | 'normal' | 'custom';

/** What the first-run wizard asked. */
export interface WizardAnswers {
  bedCheck: boolean;
  wash: { habit: WashHabit; days?: number };
  rails: { x: RailType; y: RailType; z: RailType };
  belts: boolean;
  /** Per extruder. */
  nozzle: Record<string, { type: NozzleType; km?: number }>;
  feeder: Record<string, { type: FeederType }>;
}

export interface MaintenanceSettings {
  /** Master switch for notifications. */
  notifications: boolean;
  /** Master switch for the pre-print dialog. */
  guard: boolean;
}

export const STATE_VERSION = 1;

/** Everything stored for one printer under the `state` key. */
export interface MaintenanceState {
  v: typeof STATE_VERSION;
  onboarding: { done: boolean; answers: WizardAnswers | null };
  settings: MaintenanceSettings;
  tasks: Task[];
  /**
   * Card positions in the chain editor. Absent until the user moves a card (the editor then
   * lays the cards out by itself); `x` counts from the start edge of the board, so the
   * picture mirrors in right-to-left interfaces.
   */
  layout?: Record<string, { x: number; y: number }>;
}

export interface JournalEntry {
  id: string;
  at: number;
  taskId: string;
  /** Task name at that moment (the task may be deleted later). */
  taskLabel: string;
  outcomeId: string;
  note?: string;
  /** Print totals at that moment, for the record. */
  totals: Totals | null;
}

export type TaskStatus = 'off' | 'ok' | 'soon' | 'overdue';

/** One unit of a task's progress. */
export interface UnitProgress {
  unit: Unit;
  used: number;
  interval: number;
  remaining: number;
  lead: number;
  status: 'ok' | 'soon' | 'overdue';
}

export interface TaskEvaluation {
  taskId: string;
  status: TaskStatus;
  /** Due because another task's outcome triggered it (not because its own timer ran out). */
  triggered: boolean;
  units: UnitProgress[];
}
