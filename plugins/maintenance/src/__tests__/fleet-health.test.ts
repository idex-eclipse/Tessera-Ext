// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDefaultState } from '../core/defaults';
import type { MaintenanceRuntime } from '../core/runtime';
import type { TaskEvaluation } from '../core/types';
import { resetHub } from '../hub';
import type { PluginApi } from '../sdk';
import { FLEET_HEALTH_REPORT_EVENT, MaintenanceFleetHealth } from '../ui/fleet-health';
import '../index';

const totals = { printSeconds: 0, jobs: 0, filamentMm: 0 };

/** Builds a small runtime-shaped fixture with deterministic task evaluations. */
function runtimeWith(statuses: Array<'soon' | 'overdue'>, onboarding = true): MaintenanceRuntime {
  const state = createDefaultState(['extruder'], totals, 0);
  state.onboarding.done = onboarding;
  const tasks = state.tasks.filter((task) => task.kind !== 'precheck').slice(0, statuses.length);
  const evals: TaskEvaluation[] = tasks.map((task, index) => ({
    taskId: task.id,
    status: statuses[index]!,
    triggered: false,
    units: [],
  }));
  return {
    printerId: 'target',
    state,
    evals,
    subscribe: () => () => {},
  } as unknown as MaintenanceRuntime;
}

/** Renders a contribution without starting the real runtime, isolating its public DOM contract. */
async function renderFixture(runtime: MaintenanceRuntime) {
  const element = document.createElement('tessera-maintenance-fleet-health') as MaintenanceFleetHealth;
  element.runtime = runtime;
  const reports: unknown[] = [];
  element.addEventListener(FLEET_HEALTH_REPORT_EVENT, (event) => reports.push((event as CustomEvent).detail));
  document.body.append(element);
  await element.updateComplete;
  return { element, reports };
}

afterEach(() => {
  document.body.replaceChildren();
  resetHub();
});

describe('maintenance Fleet Health contribution', () => {
  it('reports overdue work and renders at most three urgency-ordered tasks', async () => {
    const view = await renderFixture(runtimeWith(['overdue', 'overdue', 'soon', 'soon']));
    expect(view.reports).toContainEqual({ severity: 'warn', count: 2 });
    expect(view.element.shadowRoot?.querySelectorAll('li')).toHaveLength(3);
    expect(view.element.shadowRoot?.textContent).toContain('maintenance.widget.more');
    expect(view.element.shadowRoot?.querySelector('a')?.getAttribute('href')).toBe(
      '#/p/target/machine?section=tessera%2Fmaintenance%2Fmaintenance',
    );
  });

  it('keeps soon work visible without changing the shared indicator', async () => {
    const view = await renderFixture(runtimeWith(['soon']));
    expect(view.reports).toContainEqual({ severity: 'none', count: 0 });
    expect(view.element.shadowRoot?.querySelectorAll('li')).toHaveLength(1);
    expect(view.element.shadowRoot?.textContent).toContain('maintenance.summary.soon');
  });

  it('renders nothing before onboarding or when no work needs attention', async () => {
    const onboarding = await renderFixture(runtimeWith(['overdue'], false));
    expect(onboarding.reports).toContainEqual({ severity: 'none', count: 0 });
    expect(onboarding.element.shadowRoot?.textContent?.trim()).toBe('');
    onboarding.element.remove();

    const clean = await renderFixture(runtimeWith([]));
    expect(clean.reports).toContainEqual({ severity: 'none', count: 0 });
    expect(clean.element.shadowRoot?.textContent?.trim()).toBe('');
  });

  it('binds the runtime to params.printerId instead of the active printer', async () => {
    const settings = {
      get: vi.fn(() => undefined),
      set: vi.fn(),
      onChange: vi.fn(() => () => {}),
    };
    const moonraker = {
      request: vi.fn(async (method: string) => method === 'printer.objects.list'
        ? { objects: ['extruder'] }
        : { job_totals: { total_jobs: 0, total_print_time: 0, total_filament_used: 0 } }),
      subscribe: vi.fn(() => () => {}),
      onNotify: vi.fn(() => () => {}),
      onReady: vi.fn(() => () => {}),
    };
    const settingsFor = vi.fn(() => settings);
    const moonrakerFor = vi.fn(() => moonraker);
    const api = {
      printer: { id: 'active', name: 'Active' },
      settingsFor,
      moonrakerFor,
      onLocaleChange: () => () => {},
      i18n: { t: (key: string) => key },
    } as unknown as PluginApi;
    const element = document.createElement('tessera-maintenance-fleet-health') as MaintenanceFleetHealth;
    element.params = { printerId: 'target' };
    element.api = api;
    document.body.append(element);
    await element.updateComplete;

    expect(settingsFor).toHaveBeenCalledWith('target');
    expect(moonrakerFor).toHaveBeenCalledWith('target');
    expect(settingsFor).not.toHaveBeenCalledWith('active');
  });
});
