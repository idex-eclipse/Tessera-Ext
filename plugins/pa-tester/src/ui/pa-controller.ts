import type { ReactiveController } from 'lit';

import type { TesseraElement } from '../base-element';
import { startForceSource, type SourceKind, type SourceState } from '../force-source';
import type { ForceUnit } from '../force-parse';
import { normalizeLines } from '../parse';
import { pickLoadCell, readPrinterConfig } from '../printer-config';
import {
  appendLines,
  beginRun,
  endRun,
  expireStale,
  getState,
  resetRun,
  restoreFromHistory,
  subscribe,
  update,
  type PrinterRunState,
} from '../run-store';
import type { MoonrakerProxyHandle } from '../sdk';
import { SeriesBuffer } from '../series-buffer';

/** Status of `[pa_tester]` (get_status): the LAST result Klipper kept. */
export interface PaStatus {
  test: string | null;
  pa: number | null;
  measured: number[];
  corrected: number | null;
}

export interface ExtruderStatus {
  temperature: number | null;
  target: number | null;
  pressureAdvance: number | null;
  canExtrude: boolean | null;
}

export interface ChartInfo {
  kind: SourceKind | null;
  state: SourceState;
  unit: ForceUnit;
}

/** The longest window the chart can show; the buffer keeps this much. */
export const CHART_MAX_SECONDS = 120;

/**
 * Lit ReactiveController: everything the tab needs from Moonraker.
 *
 * Bound to the ACTIVE printer (`api.moonraker()`): our tab is a part of the
 * Calibrations page. On a printer change the controller unbinds and binds to
 * the new one; the run state of the old printer stays in run-store.
 *
 * Subscriptions are released on disconnect: the host unmounts the tab as soon
 * as the user leaves it. A run keeps going in Klipper regardless, and the
 * history restore picks it up on the next mount. The load cell trace is the
 * expensive one (see force-source.ts): it runs only while the tab asks for it
 * (`setChart(true)`) AND the page is visible.
 */
export class PaController implements ReactiveController {
  readonly #host: TesseraElement;
  #printerId = '';
  #handle: MoonrakerProxyHandle | null = null;
  #off: Array<() => void> = [];
  #extruderOff: (() => void) | null = null;
  #staleTimer: ReturnType<typeof setInterval> | null = null;

  /** Live printer status for the Run button (re-read on mount, not kept in run-store). */
  printState = '';
  homedAxes = '';
  activeExtruder = '';
  klippyReady = true;
  extruders: Record<string, ExtruderStatus> = {};
  paStatus: PaStatus | null = null;

  // ----- live chart
  readonly buffer = new SeriesBuffer(CHART_MAX_SECONDS, 8000);
  /** Bumped after every push so the chart element redraws. */
  version = 0;
  chart: ChartInfo = { kind: null, state: 'connecting', unit: 'g' };
  #chartWanted = false;
  #sensorChoice = '';
  #stopChart: (() => void) | null = null;
  #chartKey = '';

  constructor(host: TesseraElement) {
    this.#host = host;
    host.addController(this);
  }

  get printerId(): string {
    return this.#printerId;
  }

  get state(): PrinterRunState {
    return getState(this.#printerId);
  }

  get isPrinting(): boolean {
    return this.printState === 'printing' || this.printState === 'paused';
  }

  get isHomed(): boolean {
    return this.homedAxes === 'xyz';
  }

  get extruder(): ExtruderStatus | null {
    return this.extruders[this.activeExtruder] ?? null;
  }

  get handle(): MoonrakerProxyHandle | null {
    return this.#handle;
  }

  hostConnected(): void {
    document.addEventListener('visibilitychange', this.#onVisibility);
    this.#bind();
  }

  hostUpdate(): void {
    // api arrives with the first update after a lazy upgrade (see base-element.ts).
    if (!this.#handle) this.#bind();
  }

  hostDisconnected(): void {
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.#unbind();
  }

  readonly #onVisibility = (): void => this.#syncChart();

  #bind(): void {
    const api = this.#host.api;
    if (!api || this.#handle || !this.#host.isConnected) return;

    // A printer change re-binds everything (other WebSocket, other state).
    this.#off.push(
      api.onPrinterChange(() => {
        this.#unbind();
        this.#bind();
        this.#host.requestUpdate();
      }),
    );

    if (!api.printer.id) return;
    let handle: MoonrakerProxyHandle;
    try {
      handle = api.moonraker();
    } catch {
      return; // no active printer
    }
    this.#handle = handle;
    this.#printerId = api.printer.id;
    const pid = this.#printerId;

    this.#off.push(subscribe(pid, () => this.#host.requestUpdate()));

    // Status for the Run button. `immediate` delivers the current snapshot first.
    this.#off.push(
      handle.subscribe(
        { print_stats: ['state'], toolhead: ['homed_axes', 'extruder'], webhooks: ['state'] },
        (delta) => {
          if (delta?.print_stats?.state !== undefined) this.printState = String(delta.print_stats.state);
          if (delta?.toolhead?.homed_axes !== undefined) this.homedAxes = String(delta.toolhead.homed_axes);
          if (delta?.toolhead?.extruder !== undefined) this.activeExtruder = String(delta.toolhead.extruder);
          if (delta?.webhooks?.state !== undefined) this.klippyReady = delta.webhooks.state === 'ready';
          this.#host.requestUpdate();
        },
        { immediate: true },
      ),
    );

    // Last result kept by the module (only the fields it has; the object may not exist yet).
    this.#off.push(
      handle.subscribe(
        {
          pa_tester: [
            'last_pressure_advance_test',
            'last_pressure_advance',
            'last_measured_pressure_advance',
            'last_corrected_pressure_advance',
          ],
        },
        (delta) => {
          const d = delta?.pa_tester;
          if (!d) return;
          const prev = this.paStatus;
          this.paStatus = {
            test: typeof d.last_pressure_advance_test === 'string' ? d.last_pressure_advance_test : (prev?.test ?? null),
            pa: typeof d.last_pressure_advance === 'number' ? d.last_pressure_advance : (prev?.pa ?? null),
            measured: Array.isArray(d.last_measured_pressure_advance)
              ? d.last_measured_pressure_advance.filter((x: unknown) => typeof x === 'number')
              : (prev?.measured ?? []),
            corrected:
              typeof d.last_corrected_pressure_advance === 'number'
                ? d.last_corrected_pressure_advance
                : (prev?.corrected ?? null),
          };
          this.#host.requestUpdate();
        },
        { immediate: true },
      ),
    );

    // Pa_tester talks only through the console (see parse.ts).
    this.#off.push(handle.onNotify('notify_gcode_response', (params) => appendLines(pid, normalizeLines(params))));

    // Klipper restarted: a run in progress is gone, the config may have changed.
    this.#off.push(
      handle.onNotify('notify_klippy_ready', () => {
        resetRun(pid);
        void this.#loadConfig();
      }),
    );
    this.#off.push(handle.onNotify('notify_config_changed', () => void this.#loadConfig()));

    this.#staleTimer = setInterval(() => expireStale(pid), 30_000);

    if (!this.state.config) void this.#loadConfig();
    else this.#subscribeExtruders();
    if (!this.state.restored) void this.#restore();
    this.#syncChart();
  }

  #unbind(): void {
    for (const off of this.#off) off();
    this.#off = [];
    this.#extruderOff?.();
    this.#extruderOff = null;
    this.#stopChartNow();
    if (this.#staleTimer) clearInterval(this.#staleTimer);
    this.#staleTimer = null;
    this.#handle = null;
  }

  /** Reads the printer config again (the "Check again" button of the not-installed panel). */
  recheck(): Promise<void> {
    return this.#loadConfig();
  }

  async #loadConfig(): Promise<void> {
    const handle = this.#handle;
    const pid = this.#printerId;
    if (!handle) return;
    try {
      const config = await readPrinterConfig(handle);
      update(pid, { config, configError: false });
      this.#subscribeExtruders();
      this.#syncChart();
    } catch {
      update(pid, { configError: true });
    }
  }

  #subscribeExtruders(): void {
    this.#extruderOff?.();
    this.#extruderOff = null;
    const handle = this.#handle;
    const names = this.state.config?.extruders ?? [];
    if (!handle || names.length === 0) return;
    const fields = ['temperature', 'target', 'pressure_advance', 'can_extrude'];
    this.#extruderOff = handle.subscribe(
      Object.fromEntries(names.map((n) => [n, fields])),
      (delta) => {
        for (const name of names) {
          const d = delta?.[name];
          if (!d) continue;
          const prev = this.extruders[name] ?? { temperature: null, target: null, pressureAdvance: null, canExtrude: null };
          this.extruders = {
            ...this.extruders,
            [name]: {
              temperature: typeof d.temperature === 'number' ? d.temperature : prev.temperature,
              target: typeof d.target === 'number' ? d.target : prev.target,
              pressureAdvance: typeof d.pressure_advance === 'number' ? d.pressure_advance : prev.pressureAdvance,
              canExtrude: typeof d.can_extrude === 'boolean' ? d.can_extrude : prev.canExtrude,
            },
          };
        }
        this.#host.requestUpdate();
      },
      { immediate: true },
    );
  }

  async #restore(): Promise<void> {
    const handle = this.#handle;
    const pid = this.#printerId;
    if (!handle) return;
    try {
      const res = await handle.request<{ gcode_store?: Array<{ message?: string; time?: number }> }>(
        'server.gcode_store',
        { count: 300 },
      );
      restoreFromHistory(pid, res?.gcode_store ?? []);
    } catch {
      update(pid, { restored: true });
    }
  }

  // ---------------------------------------------------------------- chart

  /** Asks for the trace of the load cell `sensor` (a section name, '' — automatic). */
  setChart(wanted: boolean, sensor = ''): void {
    if (this.#chartWanted === wanted && this.#sensorChoice === sensor) return;
    this.#chartWanted = wanted;
    this.#sensorChoice = sensor;
    this.#syncChart();
  }

  clearChart(): void {
    this.buffer.clear();
    this.version++;
    this.#host.requestUpdate();
  }

  #stopChartNow(): void {
    this.#stopChart?.();
    this.#stopChart = null;
    this.#chartKey = '';
  }

  #syncChart(): void {
    const handle = this.#handle;
    const config = this.state.config;
    const want = this.#chartWanted && !document.hidden && handle !== null && config !== null;
    const cell = want && config ? pickLoadCell(config, this.#sensorChoice) : null;
    const key = cell ? `${this.#printerId}|${cell.section}` : '';

    if (key === this.#chartKey) return;
    this.#stopChartNow();
    if (!cell || !handle) return;

    this.#chartKey = key;
    this.buffer.clear();
    this.chart = { kind: null, state: 'connecting', unit: this.chart.unit };
    this.#stopChart = startForceSource(handle, cell, {
      onSamples: (samples, unit) => {
        // The unit flips when the cell gets calibrated mid-stream: old points would lie.
        if (unit !== this.chart.unit) {
          this.buffer.clear();
          this.chart = { ...this.chart, unit };
        }
        for (const s of samples) this.buffer.push(s.time, s.value);
        this.version++;
        this.#host.requestUpdate();
      },
      onSource: (kind, state) => {
        // Stream times are the printer's clock, status times ours: never mix them.
        if (this.chart.kind !== null && this.chart.kind !== kind) this.buffer.clear();
        this.chart = { ...this.chart, kind, state };
        this.#host.requestUpdate();
      },
    });
    this.#host.requestUpdate();
  }

  // ------------------------------------------------------------- commands

  /**
   * Sends one command and waits for it. `printer.gcode.script` resolves only
   * when Klipper has finished it, i.e. after the whole measurement and the
   * calculation (minutes); the host proxy has no request timeout. Meanwhile
   * the console lines arrive live.
   */
  async run(script: string): Promise<void> {
    const handle = this.#handle;
    const pid = this.#printerId;
    if (!handle || this.state.busy) return;
    beginRun(pid);
    let error: string | undefined;
    try {
      await handle.request('printer.gcode.script', { script });
    } catch (e) {
      // Klipper errors ("Extruder cannot extrude") and guard denials of OTHER
      // plugins land here; the console usually has the "!!" line as well.
      error = e instanceof Error ? e.message : String(e);
    } finally {
      endRun(pid, error);
    }
  }

  /** A short command that is not a measurement (G28, SET_PRESSURE_ADVANCE): no run state. */
  async send(script: string): Promise<boolean> {
    if (!this.#handle) return false;
    try {
      await this.#handle.request('printer.gcode.script', { script });
      return true;
    } catch (e) {
      console.warn('[pa-tester] command failed:', script, e);
      return false;
    }
  }
}
