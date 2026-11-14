import type { ReactiveController } from 'lit';

import { normalizeLines } from '../parse';
import { readPrinterConfig } from '../printer-config';
import { listResults } from '../results';
import {
  appendLines,
  beginRun,
  endRun,
  getState,
  resetRun,
  restoreFromHistory,
  setFiles,
  subscribe,
  update,
  type PrinterRunState,
} from '../run-store';
import type { MoonrakerProxyHandle } from '../sdk';
import type { TesseraElement } from '../base-element';

/**
 * Lit ReactiveController: everything the tab needs from Moonraker.
 *
 * A controller is Lit's unit of reusable lifecycle: the host element calls
 * hostConnected / hostDisconnected / hostUpdate on it, and the controller calls
 * host.requestUpdate() when its data changes. Here it owns every subscription,
 * so the element itself is only a view.
 *
 * Bound to the active printer by ID: our tab is a part of the
 * Calibrations page, which always shows the active printer. On a printer change
 * the controller unbinds and binds to the new one; the run state of the old
 * printer stays in run-store for when the user comes back.
 *
 * Subscriptions are released on disconnect: the host unmounts the tab as soon
 * as the user leaves it (another tab, another page, or "Original" chosen in the
 * host's chooser) — a Shake&Tune run keeps going in Klipper regardless, and
 * the history restore picks it up on the next mount.
 */
export class StController implements ReactiveController {
  readonly #host: TesseraElement;
  #printerId = '';
  #handle: MoonrakerProxyHandle | null = null;
  #off: Array<() => void> = [];
  #filesTimer: ReturnType<typeof setTimeout> | null = null;

  /** Live printer status for the Run button (not kept in run-store: re-read on mount). */
  printState = '';
  homedAxes = '';
  klippyReady = true;

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

  hostConnected(): void {
    this.#bind();
  }

  hostUpdate(): void {
    // api arrives with the first update after a lazy upgrade (see base-element.ts).
    if (!this.#handle) this.#bind();
  }

  hostDisconnected(): void {
    this.#unbind();
  }

  #bind(): void {
    const api = this.#host.api;
    if (!api || this.#handle || !this.#host.isConnected) return;

    // A printer change or removal re-binds everything (other WebSocket, other state).
    const rebind = () => {
      this.#unbind();
      this.#bind();
      this.#host.requestUpdate();
    };
    this.#off.push(
      api.onPrinterChange(rebind),
      api.onPrintersChange((printers) => {
        if (this.#printerId && !printers.some((printer) => printer.id === this.#printerId)) rebind();
      }),
    );

    const printerId = api.printer.id;
    if (!printerId) return;
    let handle: MoonrakerProxyHandle;
    try {
      handle = api.moonrakerFor(printerId);
    } catch {
      return; // no active printer
    }
    this.#handle = handle;
    this.#printerId = printerId;
    const pid = this.#printerId;

    this.#off.push(subscribe(pid, () => this.#host.requestUpdate()));

    // Status for the Run button. `immediate` delivers the current snapshot first.
    this.#off.push(
      handle.subscribe(
        { print_stats: ['state'], toolhead: ['homed_axes'], webhooks: ['state'] },
        (delta) => {
          if (delta?.print_stats?.state !== undefined) this.printState = String(delta.print_stats.state);
          if (delta?.toolhead?.homed_axes !== undefined) this.homedAxes = String(delta.toolhead.homed_axes);
          if (delta?.webhooks?.state !== undefined) this.klippyReady = delta.webhooks.state === 'ready';
          this.#host.requestUpdate();
        },
        { immediate: true },
      ),
    );

    // Shake&Tune talks only through the console (see parse.ts).
    this.#off.push(handle.onNotify('notify_gcode_response', (params) => appendLines(pid, normalizeLines(params))));

    // New graphs: Shake&Tune writes the PNG into the config root at the end of
    // a run. Moonraker reports every file operation; we refresh only for our
    // folder and debounce the bursts (png + stdata + cleanup of old results).
    this.#off.push(
      handle.onNotify('notify_filelist_changed', (params) => {
        const item = Array.isArray(params) ? params[0]?.item : undefined;
        const base = this.state.config?.resultsPath;
        if (!base || (item?.root === 'config' && String(item.path ?? '').startsWith(base))) this.#scheduleFiles();
      }),
    );

    // Klipper restarted: a run in progress is gone, the config may have changed.
    this.#off.push(
      handle.onNotify('notify_klippy_ready', () => {
        resetRun(pid);
        void this.#loadConfig();
      }),
    );
    this.#off.push(handle.onNotify('notify_config_changed', () => void this.#loadConfig()));

    if (!this.state.config) void this.#loadConfig();
    else this.#scheduleFiles(0);
    if (!this.state.restored) void this.#restore();
  }

  #unbind(): void {
    for (const off of this.#off) off();
    this.#off = [];
    this.#handle = null;
    this.#printerId = '';
    if (this.#filesTimer) clearTimeout(this.#filesTimer);
    this.#filesTimer = null;
  }

  async #loadConfig(): Promise<void> {
    const handle = this.#handle;
    const pid = this.#printerId;
    if (!handle) return;
    try {
      const config = await readPrinterConfig(handle);
      update(pid, { config, configError: false });
      this.#scheduleFiles(0);
    } catch {
      update(pid, { configError: true });
    }
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

  #scheduleFiles(delay = 600): void {
    if (this.#filesTimer) clearTimeout(this.#filesTimer);
    this.#filesTimer = setTimeout(() => {
      this.#filesTimer = null;
      void this.refreshFiles();
    }, delay);
  }

  async refreshFiles(): Promise<void> {
    const handle = this.#handle;
    const pid = this.#printerId;
    const base = this.state.config?.resultsPath;
    if (!handle || !base) return;
    setFiles(pid, await listResults(handle, base));
  }

  /**
   * Sends one command and waits for it. `printer.gcode.script` resolves only
   * when Klipper has finished it — for Shake&Tune that includes computing the
   * graphs (it waits for its worker process), i.e. minutes; the host proxy has
   * no request timeout. Meanwhile the console lines arrive live.
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
      // Klipper errors ("Must home axis first") and guard denials of OTHER
      // plugins land here; the console usually has the "!!" line as well.
      error = e instanceof Error ? e.message : String(e);
    } finally {
      endRun(pid, error);
      await this.refreshFiles();
    }
  }

  /** A short command that is not a test (SET_INPUT_SHAPER, G28): no run state. */
  async send(script: string): Promise<boolean> {
    if (!this.#handle) return false;
    try {
      await this.#handle.request('printer.gcode.script', { script });
      return true;
    } catch (e) {
      console.warn('[shaketune] command failed:', script, e);
      return false;
    }
  }

  get handle(): MoonrakerProxyHandle | null {
    return this.#handle;
  }
}
