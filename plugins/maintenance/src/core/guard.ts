/**
 * The pre-print decision. The host calls the guard handler synchronously with a 10 s limit
 * and gives it no `api`, so the decision is taken from the last evaluation the monitor
 * cached; it never waits for the network.
 */
import type { MaintenanceState, TaskEvaluation } from './types';

export type GuardDecision =
  | { action: 'allow' }
  | {
      action: 'freeze';
      /** Ids of the overdue tasks that take part in the dialog. */
      overdue: string[];
      /** Show the "bed is clear" check with the cameras. */
      bedCheck: boolean;
    };

/**
 * No data, wizard not finished or the dialog switched off: allow. Otherwise freeze when
 * the bed check is on or an enabled task that takes part in the guard is overdue. The user
 * can always press "Start anyway"; the guard only makes sure they have seen the problem.
 */
export function decideGuard(state: MaintenanceState | null, evals: TaskEvaluation[] | null): GuardDecision {
  if (!state || !evals || !state.onboarding.done || !state.settings.guard) return { action: 'allow' };

  const byId = new Map(evals.map((e) => [e.taskId, e]));
  const overdue = state.tasks
    .filter((t) => t.enabled && t.guard && t.kind !== 'precheck' && byId.get(t.id)?.status === 'overdue')
    .map((t) => t.id);
  const bedCheck = state.tasks.some((t) => t.kind === 'precheck' && t.enabled);

  return overdue.length === 0 && !bedCheck ? { action: 'allow' } : { action: 'freeze', overdue, bedCheck };
}
