/**
 * Decides WHICH reminders to send now. The host's notification API has no ids, actions or
 * storage (the same text within 100 ms is the only dedupe), so the plugin keeps its own
 * record of what it already said: `task.notified`, saved with the state. Sending itself
 * (translated text, `api.notifications.push`) is the caller's job.
 */
import type { MaintenanceState, NotifyLevel, TaskEvaluation } from './types';

/** What caused this evaluation. Only a finished print repeats an overdue reminder. */
export type NotifyTrigger = 'start' | 'printEnd' | 'history' | 'timer';

export interface NotifyItem {
  taskId: string;
  level: NotifyLevel;
}

const DAY_MS = 86_400_000;

export interface NotifyPlan {
  items: NotifyItem[];
  /** The state with `notified` updated; equal to the input when nothing changed. */
  state: MaintenanceState;
}

export function planNotifications(
  state: MaintenanceState,
  evals: TaskEvaluation[],
  now: number,
  trigger: NotifyTrigger,
): NotifyPlan {
  // Until the wizard is done nobody has chosen intervals, so the defaults must not nag.
  if (!state.onboarding.done) return { items: [], state };

  const byId = new Map(evals.map((e) => [e.taskId, e]));
  const items: NotifyItem[] = [];
  let changed = false;

  const tasks = state.tasks.map((task) => {
    const ev = byId.get(task.id);
    const prev = task.notified;

    // Back to normal (timer reset, interval raised, task disabled): forget the old reminder
    // so the next cycle starts clean.
    if (!ev || ev.status === 'ok' || ev.status === 'off') {
      if (!prev) return task;
      changed = true;
      return { ...task, notified: null };
    }

    if (!state.settings.notifications || !task.notify) return task;

    const level: NotifyLevel = ev.status;
    const send =
      !prev ||
      (level === 'overdue' && prev.level === 'soon') ||
      (level === 'overdue' && prev.level === 'overdue' && trigger === 'printEnd' && now - prev.at >= DAY_MS);
    if (!send) return task;

    items.push({ taskId: task.id, level });
    changed = true;
    return { ...task, notified: { level, at: now } };
  });

  return { items, state: changed ? { ...state, tasks } : state };
}
