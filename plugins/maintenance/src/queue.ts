/**
 * The pre-print guard and the queue of dialogs it opens.
 *
 * The host calls the guard handler synchronously, gives it no `api`, and parks the request
 * until `api.guards.resume(token, …)`. So the handler decides from the cached evaluation (no
 * network), stores the token here and freezes; the always-mounted overlay element reads this
 * queue, shows one dialog at a time and resumes the token. Several print starts at once
 * (two printers) simply wait in line.
 */
import { decideGuard } from './core/guard';
import { peekRuntime } from './hub';
import type { PluginApi } from './sdk';

export interface PendingStart {
  token: string;
  printerId: string;
  method: string;
  /** Print file for `printer.print.start`; the job queue has none. */
  filename: string;
  /** Ids of the overdue tasks to list. */
  overdue: string[];
  /** Show the bed check (cameras and the confirmation). */
  bedCheck: boolean;
}

interface GuardRequest {
  method: string;
  params?: unknown;
  targetPrinterId?: string;
}

/** Reason key shown by the host when the user cancels the print in the dialog. */
export const CANCEL_REASON = 'maintenance.guard.cancelled';

let api: PluginApi | null = null;
const queue: PendingStart[] = [];
const listeners = new Set<() => void>();

/** The overlay hands its api over; without it the guard lets everything through. */
export function stashApi(a: PluginApi | null): void {
  api = a;
}

function emit(): void {
  for (const cb of listeners) cb();
}

export function subscribeQueue(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The dialog to show now, or null. */
export function currentStart(): PendingStart | null {
  return queue[0] ?? null;
}

/** Guard handler named in manifest.json. Never throws: an error in a guard means "deny". */
export function guardPrintStart(
  request: GuardRequest,
  token: string,
  ctx?: { targetPrinterId?: string },
): { action: 'allow' } | { action: 'freeze' } {
  try {
    // No overlay mounted yet, so nobody could resume the token: do not park the print.
    if (!api) return { action: 'allow' };
    const printerId = ctx?.targetPrinterId ?? request.targetPrinterId ?? api.printer.id;
    const rt = peekRuntime(printerId);
    if (!rt?.state) return { action: 'allow' };
    // "Days" move with the clock, not with Moonraker events: bring the evaluation up to date.
    rt.reevaluate();
    const decision = decideGuard(rt.state, rt.evals);
    if (decision.action === 'allow') return decision;

    const filename = (request.params as { filename?: unknown } | undefined)?.filename;
    queue.push({
      token,
      printerId,
      method: request.method,
      filename: typeof filename === 'string' ? filename : '',
      overdue: decision.overdue,
      bedCheck: decision.bedCheck,
    });
    emit();
    return { action: 'freeze' };
  } catch (e) {
    console.warn('[maintenance] guard failed, letting the print through', e);
    return { action: 'allow' };
  }
}

/** The user's choice for the dialog at the head of the queue. */
export function resolveStart(accept: boolean): PendingStart | null {
  const item = queue.shift();
  if (!item) return null;
  if (accept) api?.guards.resume(item.token, 'accept');
  else api?.guards.resume(item.token, 'deny', CANCEL_REASON);
  emit();
  return item;
}

/** For tests. */
export function resetQueue(): void {
  queue.length = 0;
  api = null;
  listeners.clear();
}
