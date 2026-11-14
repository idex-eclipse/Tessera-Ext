import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import {
  COMMANDS,
  METHODS,
  buildCommand,
  commandDef,
  paramsFor,
  setPaCommand,
  type CommandId,
} from '../commands';
import {
  applyFilter,
  clampFilterMs,
  FILTER_KINDS,
  FILTER_MS_DEFAULT,
  FILTER_MS_MAX,
  FILTER_MS_MIN,
  parseFilterKind,
  type FilterKind,
} from '../force-filter';
import { MAINS_HZ, parseMainsHz, type MainsHz } from '../mains-filter';
import type { PaMethod } from '../parse';
import { pickLoadCell } from '../printer-config';
import type { PaForceChart } from './force-chart';
import { PaController } from './pa-controller';
import { styles } from './styles';

const HELP_ICON = html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
  <line x1="12" y1="17" x2="12.01" y2="17"></line>
</svg>`;

const CHART_WINDOWS = [30, 60, 120] as const;

/** pa_tester is not in mainline Klipper: it lives in this branch of the dmbutyugin fork. */
const PA_TESTER_BRANCH_URL = 'https://github.com/dmbutyugin/klipper/tree/generic-cartesian';

const fmt = (n: number | null | undefined, digits = 4): string => (n === null || n === undefined ? '—' : n.toFixed(digits));

/**
 * <tessera-pa-tester-tab> — our contribution to `@core/calibrations#tabs`.
 *
 * manifest.json:
 *   { "point": "@core/calibrations#tabs", "kind": "tab", "version": 1, … }
 *
 * - kind `tab`: we render the WHOLE content of a new tab; the tab button and
 *   its title (`titleKey`) are the owner's (Calibrations).
 * - mode `append` (declared by the owner): the tab sits next to the others, no
 *   chooser, no replacement of anything.
 *
 * Two panels, like the Calibrations tabs around us: "Pressure Advance"
 * (command, parameters, G-code preview, run, result) and "Load cell" (live
 * trace of the force sensor, the way the Heaters tab draws a temperature).
 *
 * Settings (`api.settingsFor(printerId)`, per printer): command, method, field values, the
 * state, window, display filter and mains filter of the chart.
 */
export class PaTesterTab extends TesseraElement {
  static override styles = styles;

  static override properties = {
    ...TesseraElement.properties,
    command: { state: true },
    method: { state: true },
    values: { state: true },
    chartOpen: { state: true },
    chartSeconds: { state: true },
    chartPaused: { state: true },
    chartFilter: { state: true },
    chartFilterMs: { state: true },
    chartRaw: { state: true },
    chartMains: { state: true },
    chartMainsHz: { state: true },
    copied: { state: true },
    helpOpen: { state: true },
  };

  declare command: CommandId;
  declare method: PaMethod;
  declare values: Record<string, string>;
  declare chartOpen: boolean;
  declare chartSeconds: number;
  declare chartPaused: boolean;
  declare chartFilter: FilterKind;
  declare chartFilterMs: number;
  declare chartRaw: boolean;
  declare chartMains: boolean;
  declare chartMainsHz: MainsHz;
  declare copied: string | null;
  declare helpOpen: boolean;

  readonly #ctl = new PaController(this);
  /** Printer whose settings are loaded into the fields. */
  #settingsFor = '';
  #copiedTimer: ReturnType<typeof setTimeout> | null = null;
  #offTheme: (() => void) | null = null;

  constructor() {
    super();
    this.command = 'test';
    this.method = 'step_response';
    this.values = {};
    this.chartOpen = true;
    this.chartSeconds = 30;
    this.chartPaused = false;
    this.chartFilter = 'raw';
    this.chartFilterMs = FILTER_MS_DEFAULT;
    this.chartRaw = false;
    this.chartMains = false;
    this.chartMainsHz = 50;
    this.copied = null;
    this.helpOpen = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // uPlot paints on a canvas: the colours are read when the chart is built.
    this.#offTheme = this.api?.onThemeChange(() => this.renderRoot.querySelector<PaForceChart>('tessera-pa-force-chart')?.restyle()) ?? null;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    const pid = this.#ctl.printerId;
    if (this.api && pid && pid !== this.#settingsFor) {
      this.#settingsFor = pid;
      this.#readSettings();
    }
    // The trace runs only while the panel is open (see PaController).
    this.#ctl.setChart(this.chartOpen && this.#hasSensor(), this.values.FORCE_SENSOR ?? '');
    this.#ctl.setMains(this.chartMains ? this.chartMainsHz : 0);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#offTheme?.();
    this.#offTheme = null;
    this.#watchHelp(false);
    this.#settingsFor = '';
    if (this.#copiedTimer) clearTimeout(this.#copiedTimer);
  }

  #readSettings(): void {
    const s = this.api!.settingsFor(this.#settingsFor);
    const cmd = s.get<CommandId>('command');
    this.command = COMMANDS.some((c) => c.id === cmd) ? cmd! : 'test';
    const method = s.get<PaMethod>('method');
    this.method = method && METHODS.includes(method) ? method : 'step_response';
    this.values = s.get<Record<string, string>>('values') ?? {};
    this.chartOpen = s.get<boolean>('chartOpen') ?? true;
    const sec = s.get<number>('chartSeconds');
    this.chartSeconds = CHART_WINDOWS.includes(sec as 30) ? sec! : 30;
    this.chartFilter = parseFilterKind(s.get<string>('chartFilter'));
    this.chartFilterMs = clampFilterMs(s.get<number>('chartFilterMs'));
    this.chartRaw = s.get<boolean>('chartRaw') ?? false;
    this.chartMains = s.get<boolean>('chartMains') ?? false;
    this.chartMainsHz = parseMainsHz(s.get<number>('chartMainsHz'));
  }

  #save(key: string, value: unknown): void {
    if (this.api && this.#settingsFor) this.api.settingsFor(this.#settingsFor).set(key, value);
  }

  #hasSensor(): boolean {
    const config = this.#ctl.state.config;
    return Boolean(config?.hasPaTester && pickLoadCell(config, this.values.FORCE_SENSOR ?? ''));
  }

  // ---------------------------------------------------------------- actions

  #setCommand(id: CommandId): void {
    this.command = id;
    this.#save('command', id);
  }

  #setMethod(m: PaMethod): void {
    this.method = m;
    this.#save('method', m);
  }

  #setValue(key: string, value: string): void {
    this.values = { ...this.values, [key]: value };
    this.#save('values', this.values);
  }

  #toggleChart(): void {
    this.chartOpen = !this.chartOpen;
    this.#save('chartOpen', this.chartOpen);
  }

  #setSeconds(s: number): void {
    this.chartSeconds = s;
    this.#save('chartSeconds', s);
  }

  #setFilter(kind: FilterKind): void {
    this.chartFilter = kind;
    this.#save('chartFilter', kind);
  }

  #setFilterMs(raw: number): void {
    // an empty or invalid field is ignored until the user types a number
    if (!Number.isFinite(raw)) return;
    this.chartFilterMs = clampFilterMs(raw);
    this.#save('chartFilterMs', this.chartFilterMs);
  }

  #setRaw(on: boolean): void {
    this.chartRaw = on;
    this.#save('chartRaw', on);
  }

  #setMains(on: boolean): void {
    this.chartMains = on;
    this.#save('chartMains', on);
  }

  #setMainsHz(hz: MainsHz): void {
    this.chartMainsHz = hz;
    this.#save('chartMainsHz', hz);
  }

  /** Memo of the filtered extremes: the tab renders on every batch, the filter should not rerun for that. */
  #extremes: { key: string; min: number; max: number } | null = null;

  /**
   * Min / max of the drawn trace: the raw window, or the filtered curve (for the envelope
   * its lower and upper lines). Null when there is nothing to show.
   */
  #traceRange(): { min: number; max: number } | null {
    const buf = this.#ctl.buffer;
    if (this.chartFilter === 'raw') return buf.range();
    if (buf.length === 0) return null;
    const key = `${this.#ctl.version}|${this.#ctl.printerId}|${this.chartFilter}|${this.chartFilterMs}`;
    if (this.#extremes?.key !== key) {
      const cols = applyFilter(this.chartFilter, this.chartFilterMs, buf.times(), buf.values()).cols;
      const lower = cols[0]!;
      const upper = cols[cols.length - 1]!;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < lower.length; i++) {
        if (lower[i]! < min) min = lower[i]!;
        if (upper[i]! > max) max = upper[i]!;
      }
      this.#extremes = { key, min, max };
    }
    return this.#extremes;
  }

  #filterName(k: FilterKind): string {
    return this.t(`patester.chart.filter_${k}`);
  }

  #request(): void {
    const def = commandDef(this.command);
    const built = buildCommand(def, this.method, this.values);
    if (built.invalid.length || this.#blocked()) return;
    if (def.applies) this.renderRoot.querySelector('dialog')?.showModal();
    else void this.#ctl.run(built.script);
  }

  #confirm(): void {
    const built = buildCommand(commandDef(this.command), this.method, this.values);
    this.renderRoot.querySelector('dialog')?.close();
    if (built.invalid.length || this.#blocked()) return;
    void this.#ctl.run(built.script);
  }

  async #applyMeasured(): Promise<void> {
    const cmd = setPaCommand(this.#ctl.state.result.value, this.#ctl.activeExtruder || null);
    if (cmd) await this.#ctl.send(cmd);
  }

  async #copy(text: string, id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context; printers are usually plain http on the LAN.
      window.prompt(this.t('patester.common.copyManually'), text);
      return;
    }
    this.copied = id;
    if (this.#copiedTimer) clearTimeout(this.#copiedTimer);
    this.#copiedTimer = setTimeout(() => (this.copied = null), 1500);
  }

  // ------------------------------------------------------------------ help

  /**
   * The help popover lives in the browser's TOP LAYER (Popover API): our panel
   * clips its content and the Calibrations page is a size container, so a
   * positioned div of ours could not leave the page area. `popover="auto"`
   * brings light dismiss for free; we place it next to the button like the
   * host's HeaderHelp does.
   */
  readonly #placeHelp = (): void => {
    const btn = this.renderRoot.querySelector<HTMLElement>('.help-btn');
    const menu = this.renderRoot.querySelector<HTMLElement>('.help-menu');
    if (!btn || !menu) return;
    const r = btn.getBoundingClientRect();
    const mh = menu.offsetHeight;
    const mw = menu.offsetWidth;
    const spaceBelow = window.innerHeight - r.bottom - 4;
    const top =
      mh <= spaceBelow ? r.bottom + 4 : mh <= r.top - 4 ? r.top - 4 - mh : Math.max(8, window.innerHeight - mh - 8);
    menu.style.top = `${top}px`;
    if (document.documentElement.getAttribute('dir') === 'rtl') {
      menu.style.left = `${Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - mw - 8))}px`;
      menu.style.right = 'auto';
    } else {
      const right = Math.min(Math.max(8, window.innerWidth - r.right), Math.max(8, window.innerWidth - mw - 8));
      menu.style.right = `${right}px`;
      menu.style.left = 'auto';
    }
  };

  #watchHelp(on: boolean): void {
    window.removeEventListener('resize', this.#placeHelp);
    document.removeEventListener('scroll', this.#placeHelp, true);
    if (!on) return;
    window.addEventListener('resize', this.#placeHelp);
    document.addEventListener('scroll', this.#placeHelp, true);
  }

  #onHelpToggle(e: Event): void {
    this.helpOpen = (e as ToggleEvent).newState === 'open';
    if (this.helpOpen) this.#placeHelp();
    this.#watchHelp(this.helpOpen);
  }

  /** Why Run is not possible now, or null. Our own requests skip our guard (see guard.ts), so we check here. */
  #blocked(): string | null {
    const ctl = this.#ctl;
    const config = ctl.state.config;
    if (!ctl.klippyReady) return this.t('patester.block.klippy');
    if (ctl.state.busy || ctl.state.result.running) return this.t('patester.block.running');
    if (ctl.isPrinting) return this.t('patester.block.printing');
    if (!ctl.isHomed) return this.t('patester.block.homing');
    if (config && !pickLoadCell(config, this.values.FORCE_SENSOR ?? '')) {
      return config.loadCells.length === 0 ? this.t('patester.block.noSensor') : this.t('patester.block.ambiguous');
    }
    if (ctl.extruder?.canExtrude === false) return this.t('patester.block.cold');
    return null;
  }

  // ---------------------------------------------------------------- render

  override render(): TemplateResult {
    const s = this.#ctl.state;
    if (!this.api || !this.#ctl.printerId) return html`<p class="muted">${this.t('patester.common.noPrinter')}</p>`;
    if (!s.config) {
      return html`<section class="panel"><div class="panel-body">
        <p class="muted">${s.configError ? this.t('patester.common.configError') : this.t('patester.common.loading')}</p>
      </div></section>`;
    }
    if (!s.config.hasPaTester) return this.#renderNotInstalled(s.config.loadCells.length > 0);
    return html`${this.#renderRunPanel()}${this.#renderChartPanel()}${this.#renderConfirm()}`;
  }

  /**
   * No `[pa_tester]` section. The tab is always shown (no `available` export),
   * so this is what the user finds: where the module lives and what to add.
   * The config is re-read on `notify_klippy_ready` / `notify_config_changed`
   * (PaController), and by the button for the impatient.
   */
  #renderNotInstalled(hasLoadCell: boolean): TemplateResult {
    return html`<section class="panel">
      <div class="panel-header">
        <span class="panel-title">${this.t('patester.install.title')}</span>
        <button type="button" class="btn" @click=${() => void this.#ctl.recheck()}>${this.t('patester.install.recheck')}</button>
      </div>
      <div class="panel-body">
        <p>${this.t('patester.install.intro')}</p>
        ${hasLoadCell ? nothing : html`<p class="warn">${this.t('patester.install.noLoadCell')}</p>`}
        <ol class="steps">
          <li>
            ${this.t('patester.install.stepModule')}
            <a href=${PA_TESTER_BRANCH_URL} target="_blank" rel="noopener noreferrer">dmbutyugin/klipper (generic-cartesian)</a>
          </li>
          <li>${this.t('patester.install.stepNumpy')}</li>
          <li>
            ${this.t('patester.install.stepConfig')}
            <code class="gcode">[pa_tester]
force_sensor: load_cell
high_flow: 12
purge_length: 30</code>
          </li>
          <li>${this.t('patester.install.stepExtruder')}</li>
          <li>${this.t('patester.install.stepRestart')}</li>
        </ol>
      </div>
    </section>`;
  }

  #renderHelp(): TemplateResult {
    const title = this.t('patester.help.title');
    return html`
      <button
        class="icon-btn help-btn ${this.helpOpen ? 'active' : ''}"
        popovertarget="pa-help"
        title=${title}
        aria-label=${title}
      >${HELP_ICON}</button>
      <div id="pa-help" class="help-menu" popover="auto" role="dialog" aria-label=${title} @toggle=${this.#onHelpToggle}>
        <div class="help-title">${title}</div>
        <div class="help-body">
          <h4>${this.t('patester.help.runTitle')}</h4>
          <p>${this.t('patester.help.run')}</p>
          <h4>${this.t('patester.help.applyTitle')}</h4>
          <p>${this.t('patester.help.apply')}</p>
          <h4>${this.t('patester.help.chartTitle')}</h4>
          <p>${this.t('patester.help.chart')}</p>
        </div>
      </div>
    `;
  }

  #renderField(key: string): TemplateResult {
    const p = paramsFor(this.method).find((x) => x.key === key)!;
    const config = this.#ctl.state.config!;
    const value = this.values[key] ?? '';
    const built = buildCommand(commandDef(this.command), this.method, this.values);
    const invalid = built.invalid.includes(key);
    const disabled = this.#ctl.state.busy;
    const onInput = (e: Event) => this.#setValue(key, (e.target as HTMLInputElement | HTMLSelectElement).value);

    let control: TemplateResult;
    if (p.type === 'sensor' || p.type === 'extruder') {
      const options = p.type === 'sensor' ? config.loadCells.map((c) => c.section) : config.extruders;
      control = html`<select .value=${value} ?disabled=${disabled} @change=${onInput}>
        <option value="">${this.t('patester.common.default')}</option>
        ${options.map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}
      </select>`;
    } else if (p.type === 'sign') {
      control = html`<select .value=${value} ?disabled=${disabled} @change=${onInput}>
        <option value="">${this.t('patester.common.default')}</option>
        ${['-1', '0', '1'].map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}
      </select>`;
    } else {
      const configured = config.options[key.toLowerCase()];
      control = html`<input
        type=${p.type === 'range' ? 'text' : 'number'}
        inputmode="decimal"
        step=${p.type === 'int' ? '1' : 'any'}
        placeholder=${configured ?? p.placeholder ?? '—'}
        .value=${value}
        ?disabled=${disabled}
        @input=${onInput}
      />`;
    }
    return html`<label class="field ${invalid ? 'invalid' : ''}" title=${this.t(`patester.param.${key}`)}>
      <span class="field-label mono">${key}</span>
      ${control}
    </label>`;
  }

  #renderRunPanel(): TemplateResult {
    const ctl = this.#ctl;
    const s = ctl.state;
    const r = s.result;
    const def = commandDef(this.command);
    const built = buildCommand(def, this.method, this.values);
    const blocked = this.#blocked();
    const running = s.busy || r.running;
    const pa = ctl.extruder?.pressureAdvance ?? null;
    const apply = setPaCommand(r.value, ctl.activeExtruder || null);

    return html`
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">${this.t('patester.title')}</span>
          ${pa !== null
            ? html`<span class="chip mono" title=${this.t('patester.result.current')}>PA ${fmt(pa, 4)}</span>`
            : nothing}
          ${this.#renderHelp()}
        </header>
        <div class="panel-body">
          <div class="sel-row" role="radiogroup" aria-label=${this.t('patester.command.label')}>
            ${COMMANDS.map(
              (c) => html`<button
                class="sel-btn ${c.id === this.command ? 'active' : ''}"
                role="radio"
                aria-checked=${c.id === this.command}
                ?disabled=${s.busy}
                title=${c.gcode}
                @click=${() => this.#setCommand(c.id)}
              >${this.t(`patester.command.${c.id}`)}</button>`,
            )}
          </div>
          <p class="muted">${this.t(`patester.command.${this.command}Hint`)}</p>

          <div class="sel-row" role="radiogroup" aria-label=${this.t('patester.method.label')}>
            ${METHODS.map(
              (m) => html`<button
                class="sel-btn ${m === this.method ? 'active' : ''}"
                role="radio"
                aria-checked=${m === this.method}
                ?disabled=${s.busy}
                @click=${() => this.#setMethod(m)}
              >${this.t(`patester.method.${m}`)}</button>`,
            )}
          </div>
          <p class="muted">${this.t(`patester.method.${this.method}Hint`)}</p>

          <div class="fields">${paramsFor(this.method).map((p) => this.#renderField(p.key))}</div>

          ${built.invalid.length
            ? html`<p class="error">${this.t('patester.block.invalid', { fields: built.invalid.join(', ') })}</p>`
            : nothing}
          ${blocked && !running ? html`<p class="warn">${blocked}</p>` : nothing}

          <div class="gcode-row">
            <code class="gcode mono">${built.script}</code>
            <button class="btn" @click=${() => void this.#copy(built.script, 'gcode')}>
              ${this.copied === 'gcode' ? this.t('patester.common.copied') : this.t('patester.common.copy')}
            </button>
          </div>
          <div class="row">
            <button class="btn primary" ?disabled=${Boolean(blocked) || built.invalid.length > 0} @click=${() => this.#request()}>
              ${running ? html`<span class="spinner"></span> ${this.t('patester.run.running')}` : this.t(`patester.run.${this.command}`)}
            </button>
            ${!ctl.isHomed && ctl.klippyReady && !running && !ctl.isPrinting
              ? html`<button class="btn" @click=${() => void ctl.send('G28')}>${this.t('patester.run.home')}</button>`
              : nothing}
          </div>

          ${running
            ? html`<p class="row muted">
                <span class="spinner"></span>
                ${s.external ? html`<span class="chip">${this.t('patester.run.external')}</span>` : nothing}
                ${this.t('patester.run.started')}
              </p>`
            : nothing}
          ${r.error ? html`<p class="error">${r.error}</p>` : nothing}

          ${this.#renderResult(apply, running)}

          ${s.lines.length
            ? html`<details class="log">
                <summary>${this.t('patester.run.log', { count: s.lines.length })}</summary>
                <pre class="mono">${s.lines.map((l) => html`<span class=${l.startsWith('!!') ? 'err' : ''}>${l}\n</span>`)}</pre>
              </details>`
            : nothing}
        </div>
      </section>
    `;
  }

  #renderResult(apply: string | null, running: boolean): TemplateResult | typeof nothing {
    const r = this.#ctl.state.result;
    const st = this.#ctl.paStatus;
    const hasLog = r.perFlow.length || r.search.length || r.overall !== null || r.found !== null;

    if (!hasLog) {
      return st?.pa !== null && st?.pa !== undefined
        ? html`<p class="muted">${this.t('patester.result.lastKlipper', { test: st.test ?? '—', pa: fmt(st.pa) })}</p>`
        : nothing;
    }

    return html`
      <div class="card">
        <h4>${this.t('patester.result.title')}</h4>
        ${r.perFlow.length
          ? html`<table>
              <thead><tr><th>${this.t('patester.result.flow')}</th><th>${this.t('patester.result.pa')}</th></tr></thead>
              <tbody>${r.perFlow.map(
                (f) => html`<tr><td class="mono">${f.flow.toFixed(2)}</td><td class="mono">${f.pa.toFixed(3)}</td></tr>`,
              )}</tbody>
            </table>`
          : nothing}
        ${r.search.length
          ? html`<table>
              <thead><tr><th>${this.t('patester.result.tested')}</th><th></th></tr></thead>
              <tbody>${r.search.map(
                (x) => html`<tr>
                  <td class="mono">${x.pa.toFixed(4)}</td>
                  <td>${x.overshoot ? this.t('patester.result.overshoot') : this.t('patester.result.noOvershoot')}</td>
                </tr>`,
              )}</tbody>
            </table>`
          : nothing}
        ${r.overall !== null ? html`<p class="ok">${this.t('patester.result.overall')}: <b class="mono">${fmt(r.overall, 3)}</b></p>` : nothing}
        ${r.found !== null ? html`<p class="ok">${this.t('patester.result.found')}: <b class="mono">${fmt(r.found)}</b></p>` : nothing}
        ${r.corrected !== null ? html`<p class="ok">${this.t('patester.result.corrected')}: <b class="mono">${fmt(r.corrected)}</b></p>` : nothing}
        ${r.forceSign !== null ? html`<p class="muted">${this.t('patester.result.forceSign', { sign: r.forceSign })}</p>` : nothing}
        ${r.warnings.map((w) => html`<p class="warn">${w}</p>`)}
        ${apply && !running && this.command === 'test' && this.#ctl.klippyReady
          ? html`<div class="row">
              <button class="btn" @click=${() => void this.#applyMeasured()}>${this.t('patester.run.applyMeasured')}</button>
              <button class="btn" @click=${() => void this.#copy(apply, 'apply')}>
                ${this.copied === 'apply' ? this.t('patester.common.copied') : this.t('patester.common.copy')}
              </button>
              <code class="mono muted">${apply}</code>
            </div>
            <p class="muted">${this.t('patester.run.saveHint')}</p>`
          : nothing}
      </div>
    `;
  }

  #renderConfirm(): TemplateResult {
    const built = buildCommand(commandDef(this.command), this.method, this.values);
    return html`<dialog class="confirm" @click=${(e: MouseEvent) => e.target === e.currentTarget && (e.currentTarget as HTMLDialogElement).close()}>
      <div class="confirm-body">
        <h3>${this.t('patester.confirm.title')}</h3>
        <p>${this.t('patester.confirm.body')}</p>
        <code class="gcode mono">${built.script}</code>
        <div class="row end">
          <button class="btn" @click=${(e: Event) => ((e.currentTarget as HTMLElement).closest('dialog') as HTMLDialogElement).close()}>
            ${this.t('patester.confirm.cancel')}
          </button>
          <button class="btn primary" @click=${() => this.#confirm()}>${this.t('patester.confirm.ok')}</button>
        </div>
      </div>
    </dialog>`;
  }

  #renderChartPanel(): TemplateResult {
    const ctl = this.#ctl;
    const config = ctl.state.config!;
    const cell = pickLoadCell(config, this.values.FORCE_SENSOR ?? '');
    const last = ctl.buffer.last();
    const range = this.#traceRange();
    const unit = ctl.chart.unit === 'g' ? 'g' : this.t('patester.chart.counts');
    const digits = ctl.chart.unit === 'g' ? 2 : 0;
    const num = (n: number | undefined) => (n === undefined ? '—' : `${n.toFixed(digits)} ${unit}`);

    let source: TemplateResult | typeof nothing = nothing;
    if (ctl.chart.kind === 'stream' && ctl.chart.state === 'live') {
      source = html`<span class="chip">${this.t('patester.chart.sourceStream')}</span>`;
    } else if (ctl.chart.kind === 'status') {
      source = html`<span class="chip" title=${this.t('patester.chart.sourceStatusHint')}>${this.t('patester.chart.sourceStatus')}</span>`;
    }

    let empty = this.t('patester.chart.noData');
    if (!cell) empty = config.loadCells.length ? this.t('patester.block.ambiguous') : this.t('patester.block.noSensor');
    else if (!this.chartOpen) empty = '';
    else if (ctl.chart.state === 'connecting') empty = this.t('patester.chart.connecting');

    return html`
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">${this.t('patester.chart.title')}</span>
          ${cell ? html`<span class="chip mono" title=${cell.section}>${cell.section}</span>` : nothing}
          ${this.chartOpen ? source : nothing}
          <button class="btn" @click=${() => this.#toggleChart()}>
            ${this.chartOpen ? this.t('patester.chart.hide') : this.t('patester.chart.show')}
          </button>
        </header>
        ${this.chartOpen
          ? html`<div class="panel-body">
              <div class="row">
                <span class="chip mono">${this.t('patester.chart.now')} ${num(last?.value)}</span>
                <span class="chip mono">${this.t('patester.chart.min')} ${num(range?.min)}</span>
                <span class="chip mono">${this.t('patester.chart.max')} ${num(range?.max)}</span>
              </div>
              <tessera-pa-force-chart
                .buffer=${ctl.buffer}
                .version=${ctl.version}
                .unit=${ctl.chart.unit}
                .seconds=${this.chartSeconds}
                .paused=${this.chartPaused}
                .filter=${this.chartFilter}
                .filterMs=${this.chartFilterMs}
                .showRaw=${this.chartRaw}
                .emptyText=${empty}
              ></tessera-pa-force-chart>
              <div class="row">
                <div class="sel-row" role="radiogroup" aria-label=${this.t('patester.chart.window')}>
                  ${CHART_WINDOWS.map(
                    (w) => html`<button
                      class="sel-btn ${w === this.chartSeconds ? 'active' : ''}"
                      role="radio"
                      aria-checked=${w === this.chartSeconds}
                      @click=${() => this.#setSeconds(w)}
                    >${w} ${this.t('patester.chart.sec')}</button>`,
                  )}
                </div>
                <button class="btn" @click=${() => (this.chartPaused = !this.chartPaused)}>
                  ${this.chartPaused ? this.t('patester.chart.resume') : this.t('patester.chart.pause')}
                </button>
                <button class="btn" @click=${() => ctl.clearChart()}>${this.t('patester.chart.clear')}</button>
              </div>
              <div class="row">
                <label class="field">
                  <span class="field-label">${this.t('patester.chart.filter')}</span>
                  <select @change=${(e: Event) => this.#setFilter(parseFilterKind((e.target as HTMLSelectElement).value))}>
                    ${FILTER_KINDS.map(
                      (k) => html`<option value=${k} ?selected=${k === this.chartFilter}>${this.#filterName(k)}</option>`,
                    )}
                  </select>
                </label>
                ${this.chartFilter !== 'raw'
                  ? html`<label class="field">
                        <span class="field-label">${this.t('patester.chart.filterMs')}, ${this.t('patester.chart.ms')}</span>
                        <input
                          class="num"
                          type="number"
                          dir="ltr"
                          inputmode="numeric"
                          min=${FILTER_MS_MIN}
                          max=${FILTER_MS_MAX}
                          step="10"
                          .value=${String(this.chartFilterMs)}
                          @change=${(e: Event) => this.#setFilterMs((e.target as HTMLInputElement).valueAsNumber)}
                        />
                      </label>
                      <label class="check">
                        <input type="checkbox" .checked=${this.chartRaw} @change=${(e: Event) => this.#setRaw((e.target as HTMLInputElement).checked)} />
                        <span>${this.t('patester.chart.showRaw')}</span>
                      </label>`
                  : nothing}
                <label class="check">
                  <input type="checkbox" .checked=${this.chartMains} @change=${(e: Event) => this.#setMains((e.target as HTMLInputElement).checked)} />
                  <span>${this.t('patester.chart.mains')}</span>
                </label>
                ${this.chartMains
                  ? html`<select
                        class="end"
                        aria-label=${this.t('patester.chart.mainsHz')}
                        @change=${(e: Event) => this.#setMainsHz(parseMainsHz(Number((e.target as HTMLSelectElement).value)))}
                      >
                        ${MAINS_HZ.map((hz) => html`<option value=${hz} ?selected=${hz === this.chartMainsHz}>${hz} ${this.t('patester.chart.hz')}</option>`)}
                      </select>
                      ${!ctl.chart.mainsActive ? html`<span class="chip warn-chip end">${this.t('patester.chart.mainsLowRate')}</span>` : nothing}`
                  : nothing}
              </div>
              <p class="muted">${this.t('patester.chart.tare')}</p>
            </div>`
          : nothing}
      </section>
    `;
  }
}
