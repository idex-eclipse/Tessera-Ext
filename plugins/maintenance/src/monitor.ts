/**
 * The reminder monitor: one per page, for every printer.
 *
 * It lives in the always-mounted overlay (see ui/overlay.ts), so reminders arrive whatever
 * page the user is on. For each printer it follows the runtime's events, asks
 * planNotifications() what is new, sends it through the host's notification centre and saves
 * the "already told" marks, which is what keeps one reminder from repeating.
 */
import { planNotifications, type NotifyTrigger } from './core/notify';
import type { MaintenanceRuntime } from './core/runtime';
import { runtimeFor } from './hub';
import type { PluginApi } from './sdk';
import { notifyText } from './ui/format';

const attached = new Map<string, () => void>();
let stopPrinters: (() => void) | null = null;

/** Evaluates one runtime and sends what is due. Exported for tests. */
export function notifyRuntime(api: PluginApi, rt: MaintenanceRuntime, trigger: NotifyTrigger, now = Date.now()): void {
  const state = rt.state;
  if (!state) return;
  const plan = planNotifications(state, rt.evals, now, trigger);
  if (plan.state !== state) rt.mutate(() => plan.state);
  for (const item of plan.items) {
    const task = state.tasks.find((t) => t.id === item.taskId);
    const ev = rt.evals.find((e) => e.taskId === item.taskId);
    if (!task || !ev) continue;
    api.notifications.push({
      severity: item.level === 'overdue' ? 'error' : 'info',
      text: notifyText((k, p) => api.i18n.t(k, p), task, ev, item.level),
      label: api.i18n.t('maintenance.notify.label'),
      // The printer is passed explicitly: this runs for every printer, not only the active one.
      printerId: rt.printerId,
    });
  }
}

function attach(api: PluginApi, printerId: string): void {
  if (attached.has(printerId)) return;
  const rt = runtimeFor(api, printerId);
  attached.set(printerId, rt.onEvent((trigger) => notifyRuntime(api, rt, trigger)));
}

/** Starts watching every printer and follows the printer list. Idempotent. */
export function ensureMonitor(api: PluginApi): void {
  for (const p of api.printers) attach(api, p.id);
  if (stopPrinters) return;
  stopPrinters = api.onPrintersChange((list) => {
    for (const p of list) attach(api, p.id);
    // A removed printer stops being watched.
    const ids = new Set(list.map((p) => p.id));
    for (const [id, off] of attached) {
      if (!ids.has(id)) {
        off();
        attached.delete(id);
      }
    }
  });
}

/** For tests: forget everything. */
export function resetMonitor(): void {
  for (const off of attached.values()) off();
  attached.clear();
  stopPrinters?.();
  stopPrinters = null;
}
