import { html, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import { COMMANDS, RESULT_FOLDERS, buildCommand, commandDef, type CommandId, type ResultFolder } from '../commands';
import type { ShaperRecKind } from '../parse';
import { loadImage, type ResultFile } from '../results';
import { applyCommand, resultCards, type ResultView } from './result-cards';
import { StController } from './st-controller';
import { styles } from './styles';

type Filter = ResultFolder | 'all';

/** `help-circle` of the host's icon set (plugins/shared/icons), so our help button looks like every other. */
const HELP_ICON = html`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
  <line x1="12" y1="17" x2="12.01" y2="17"></line>
</svg>`;

/**
 * <tessera-shaketune-tab> — our contribution to `@core/calibrations#shaper`.
 *
 * manifest.json:
 *   { "point": "@core/calibrations#shaper", "kind": "tab", "version": 1, … }
 *
 * - kind `tab`: we render the WHOLE content of the Input Shaper tab; the tab
 *   button and its title stay the owner's (Calibrations).
 * - mode `alternative` (declared by the owner): the host shows either
 *   Calibrations' own Klipper content or us. The user switches with a right
 *   click on the tab or on our content (long press on touch) → the host's
 *   chooser. We cannot open that chooser ourselves — it is an owner API — so
 *   the help explains it.
 * - version 1: the contract of the point. Calibrations passes no params today;
 *   if it ever changes their meaning it bumps the version and the host stops
 *   mounting us until we follow (we would show up as "rejected" in Settings).
 *
 * Two panels, like the original tab: "Shake&Tune" (command, parameters, run,
 * results) and "Results" (Shake&Tune's graphs). Klipper's own Belts and Graphs
 * panels are simply not rendered while we replace the tab — Shake&Tune has
 * COMPARE_BELTS_RESPONSES and its own result folders.
 *
 * Settings (`api.settings`, per printer): the last command, field values per
 * command, the gallery filter, the damping checkbox.
 */
export class ShakeTuneTab extends TesseraElement {
  static override styles = styles;

  static override properties = {
    ...TesseraElement.properties,
    command: { state: true },
    values: { state: true },
    filter: { state: true },
    damping: { state: true },
    pick: { state: true },
    selected: { state: true },
    previewUrl: { state: true },
    full: { state: true },
    copied: { state: true },
    helpOpen: { state: true },
  };

  declare command: CommandId;
  declare values: Partial<Record<CommandId, Record<string, string>>>;
  declare filter: Filter;
  declare damping: boolean;
  declare pick: Partial<Record<'X' | 'Y', ShaperRecKind>>;
  declare selected: string | null;
  declare previewUrl: string | null;
  declare full: boolean;
  declare copied: string | null;
  declare helpOpen: boolean;

  readonly #ctl = new StController(this);
  /** Printer whose settings are loaded into the fields. */
  #settingsFor = '';
  #copiedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super();
    this.command = 'shaper';
    this.values = {};
    this.filter = 'all';
    this.damping = false;
    this.pick = {};
    this.selected = null;
    this.previewUrl = null;
    this.full = false;
    this.copied = null;
    this.helpOpen = false;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    super.willUpdate(changed);
    // Settings are per printer: read them whenever the tab shows another printer.
    const pid = this.#ctl.printerId;
    if (this.api && pid && pid !== this.#settingsFor) {
      this.#settingsFor = pid;
      this.#readSettings();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#releasePreview();
    this.#watchHelp(false);
    this.#settingsFor = '';
  }

  #readSettings(): void {
    const s = this.api!.settings;
    const cmd = s.get<CommandId>('command');
    this.command = COMMANDS.some((c) => c.id === cmd) ? cmd! : 'shaper';
    this.values = s.get<Partial<Record<CommandId, Record<string, string>>>>('values') ?? {};
    this.filter = s.get<Filter>('filter') ?? 'all';
    this.damping = s.get<boolean>('damping') ?? false;
  }

  #save(key: string, value: unknown): void {
    this.api?.settings.set(key, value);
  }

  // ---------------------------------------------------------------- actions

  #setCommand(id: CommandId): void {
    this.command = id;
    this.#save('command', id);
  }

  #setValue(key: string, value: string): void {
    const current = { ...(this.values[this.command] ?? {}), [key]: value };
    this.values = { ...this.values, [this.command]: current };
    this.#save('values', this.values);
  }

  #setFilter(f: Filter): void {
    this.filter = f;
    this.#save('filter', f);
  }

  async #run(): Promise<void> {
    const built = buildCommand(commandDef(this.command), this.values[this.command] ?? {});
    if (built.invalid.length || this.#blocked()) return;
    this.pick = {};
    await this.#ctl.run(built.script);
  }

  async #apply(): Promise<void> {
    const cmd = applyCommand(this.#ctl.state.result, this.pick, this.damping);
    if (cmd) await this.#ctl.send(cmd);
  }

  async #copy(text: string, id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API needs a secure context (https or localhost); printers are
      // usually plain http on the LAN. Fall back to a prompt the user can copy from.
      window.prompt(this.t('shaketune.common.copyManually'), text);
      return;
    }
    this.copied = id;
    if (this.#copiedTimer) clearTimeout(this.#copiedTimer);
    this.#copiedTimer = setTimeout(() => (this.copied = null), 1500);
  }

  async #select(file: ResultFile): Promise<void> {
    const handle = this.#ctl.handle;
    if (!handle) return;
    this.#releasePreview();
    this.selected = file.path;
    try {
      const url = await loadImage(handle, file.path);
      if (this.selected === file.path) this.previewUrl = url;
      else URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('[shaketune] graph load failed:', file.path, e);
    }
  }

  #releasePreview(): void {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
  }

  #openLightbox(): void {
    this.full = false;
    this.renderRoot.querySelector('dialog')?.showModal();
  }

  // ------------------------------------------------------------------ help

  /**
   * The help popover lives in the browser's TOP LAYER (Popover API), for the
   * same reason as the lightbox: our panel clips its content (overflow: hidden)
   * and the Calibrations page is a size container, so neither an absolute nor a
   * fixed div of ours could leave the page area. `popover="auto"` also brings
   * light dismiss (click outside, Esc) for free.
   *
   * The top layer is positioned against the viewport, so we place it next to
   * the button ourselves — the way the host's HeaderHelp does: below the
   * button (above if it does not fit), aligned to its end edge.
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
    // capture: the page scrolls in the host's container, not in the window
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
    const def = commandDef(this.command);
    if (!ctl.klippyReady) return this.t('shaketune.block.klippy');
    if (ctl.state.busy || ctl.state.result.running) return this.t('shaketune.block.running');
    if (ctl.isPrinting) return this.t('shaketune.block.printing');
    if (!ctl.isHomed) return this.t('shaketune.block.homing');
    const kin = ctl.state.config?.kinematics;
    if (def.kinematics && kin && !def.kinematics.includes(kin)) {
      return this.t('shaketune.block.kinematics', { kinematics: kin });
    }
    return null;
  }

  // ---------------------------------------------------------------- render

  override render(): TemplateResult {
    const s = this.#ctl.state;
    if (!this.api || !this.#ctl.printerId) return html`<p class="muted">${this.t('shaketune.common.noPrinter')}</p>`;
    if (!s.config) {
      return html`<section class="panel"><div class="panel-body">
        <p class="muted">${s.configError ? this.t('shaketune.common.configError') : this.t('shaketune.common.loading')}</p>
      </div></section>`;
    }
    if (!s.config.hasShakeTune) {
      // The host does not mount us without [shaketune] (see availability.ts);
      // this covers the section being removed while the tab is open.
      return html`<section class="panel"><div class="panel-body">
        <p class="warn">${this.t('shaketune.common.notInstalled')}</p>
      </div></section>`;
    }
    return html`${this.#renderRunPanel()}${this.#renderResultsPanel()}`;
  }

  #renderHelp(): TemplateResult {
    const title = this.t('shaketune.help.title');
    // popovertarget (not a click handler): a click on the invoker while the
    // popover is open closes it instead of light-dismissing and reopening it.
    return html`
      <button
        class="icon-btn help-btn ${this.helpOpen ? 'active' : ''}"
        popovertarget="st-help"
        title=${title}
        aria-label=${title}
      >${HELP_ICON}</button>
      <div id="st-help" class="help-menu" popover="auto" role="dialog" aria-label=${title} @toggle=${this.#onHelpToggle}>
        <div class="help-title">${title}</div>
        <div class="help-body">
          <h4>${this.t('shaketune.help.switchTitle')}</h4>
          <p>${this.t('shaketune.help.switch')}</p>
          <h4>${this.t('shaketune.help.runTitle')}</h4>
          <p>${this.t('shaketune.help.run')}</p>
          <h4>${this.t('shaketune.help.applyTitle')}</h4>
          <p>${this.t('shaketune.help.apply')}</p>
          <h4>${this.t('shaketune.help.resultsTitle')}</h4>
          <p>${this.t('shaketune.help.results')}</p>
        </div>
      </div>
    `;
  }

  #renderField(key: string): TemplateResult {
    const def = commandDef(this.command);
    const p = def.params.find((x) => x.key === key)!;
    const value = this.values[this.command]?.[key] ?? '';
    const built = buildCommand(def, this.values[this.command] ?? {});
    const invalid = built.invalid.includes(key);
    const disabled = this.#ctl.state.busy;
    const onInput = (e: Event) => this.#setValue(key, (e.target as HTMLInputElement | HTMLSelectElement).value);

    let control: TemplateResult;
    if (p.type === 'select' || p.type === 'chip') {
      const options = p.type === 'chip' ? this.#ctl.state.config?.chips ?? [] : (p.options ?? []);
      control = html`<select .value=${value} ?disabled=${disabled} @change=${onInput}>
        <option value="">${this.t('shaketune.common.default')}</option>
        ${options.filter((o) => o !== '').map((o) => html`<option value=${o} ?selected=${o === value}>${o}</option>`)}
      </select>`;
    } else {
      control = html`<input
        type="number"
        inputmode="decimal"
        step=${p.type === 'int' ? '1' : 'any'}
        min=${p.min ?? nothing}
        placeholder=${p.placeholder || '—'}
        .value=${value}
        ?disabled=${disabled}
        @input=${onInput}
      />`;
    }
    return html`<label class="field ${invalid ? 'invalid' : ''}" title=${this.t(`shaketune.param.${key}`)}>
      <span class="field-label mono">${key}</span>
      ${control}
    </label>`;
  }

  #renderRunPanel(): TemplateResult {
    const ctl = this.#ctl;
    const s = ctl.state;
    const r = s.result;
    const def = commandDef(this.command);
    const built = buildCommand(def, this.values[this.command] ?? {});
    const blocked = this.#blocked();
    const running = s.busy || r.running;

    const view: ResultView = {
      t: (k, p) => this.t(k, p),
      pick: this.pick,
      onPick: (axis, kind) => (this.pick = { ...this.pick, [axis]: kind }),
      damping: this.damping,
      onDamping: (on) => {
        this.damping = on;
        this.#save('damping', on);
      },
      canApply: !running && ctl.klippyReady && applyCommand(r, this.pick, this.damping) !== null,
      onApply: () => void this.#apply(),
      onCopy: (text, id) => void this.#copy(text, id),
      copied: this.copied,
    };

    return html`
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">${this.t('shaketune.title')}</span>
          ${r.version ? html`<span class="chip mono">${r.version}</span>` : nothing}
          ${this.#renderHelp()}
        </header>
        <div class="panel-body">
          <div class="sel-row" role="radiogroup" aria-label=${this.t('shaketune.command.label')}>
            ${COMMANDS.map(
              (c) => html`<button
                class="sel-btn ${c.id === this.command ? 'active' : ''}"
                role="radio"
                aria-checked=${c.id === this.command}
                ?disabled=${s.busy}
                title=${c.gcode}
                @click=${() => this.#setCommand(c.id)}
              >
                ${this.t(`shaketune.command.${c.id}`)}
              </button>`,
            )}
          </div>
          <p class="muted">${this.t(`shaketune.commandHint.${def.id}`)}</p>

          <div class="fields">${def.params.map((p) => this.#renderField(p.key))}</div>

          ${built.invalid.length
            ? html`<p class="error">${this.t('shaketune.block.invalid', { fields: built.invalid.join(', ') })}</p>`
            : nothing}
          ${blocked && !running ? html`<p class="warn">${blocked}</p>` : nothing}

          <code class="gcode mono">${built.script}</code>
          <div class="row">
            <button class="btn primary" ?disabled=${Boolean(blocked) || built.invalid.length > 0} @click=${() => void this.#run()}>
              ${running ? html`<span class="spinner"></span> ${this.t('shaketune.run.running')}` : this.t('shaketune.run.run')}
            </button>
            ${!ctl.isHomed && ctl.klippyReady && !running && !ctl.isPrinting
              ? html`<button class="btn" @click=${() => void ctl.send('G28')}>${this.t('shaketune.run.home')}</button>`
              : nothing}
            <span class="muted">${this.t('shaketune.run.duration', { minutes: def.minutes })}</span>
          </div>

          ${running
            ? html`<p class="row muted">
                <span class="spinner"></span>
                ${s.external ? html`<span class="chip">${this.t('shaketune.run.external')}</span>` : nothing}
                ${r.progress ?? this.t('shaketune.run.started')}
              </p>`
            : nothing}
          ${r.error ? html`<p class="error">${r.error}</p>` : nothing}

          ${resultCards(r, view)}

          ${s.lines.length
            ? html`<details class="log">
                <summary>${this.t('shaketune.run.log', { count: s.lines.length })}</summary>
                <pre class="mono">${s.lines.map((l) => html`<span class=${l.startsWith('!!') ? 'err' : ''}>${l}\n</span>`)}</pre>
              </details>`
            : nothing}
        </div>
      </section>
    `;
  }

  #renderResultsPanel(): TemplateResult {
    const s = this.#ctl.state;
    const config = s.config!;
    const fresh = new Set(s.fresh);
    const files = this.filter === 'all' ? s.files : s.files.filter((f) => f.folder === this.filter);
    const counts = new Map<Filter, number>([['all', s.files.length]]);
    for (const f of s.files) counts.set(f.folder, (counts.get(f.folder) ?? 0) + 1);

    let body: TemplateResult;
    if (!config.resultsPath) {
      body = html`<p class="warn">${this.t('shaketune.results.outsideConfig')}</p>`;
    } else if (!s.filesLoaded) {
      body = html`<p class="muted">${this.t('shaketune.common.loading')}</p>`;
    } else {
      body = html`
        <div class="sel-row">
          ${(['all', ...RESULT_FOLDERS] as Filter[]).map(
            (f) => html`<button class="sel-btn ${this.filter === f ? 'active' : ''}" @click=${() => this.#setFilter(f)}>
              ${this.t(`shaketune.folder.${f}`)} (${counts.get(f) ?? 0})
            </button>`,
          )}
        </div>
        ${files.length === 0
          ? html`<p class="muted">${this.t('shaketune.results.empty')}</p>`
          : html`<div class="gallery">
              ${files.map(
                (f) => html`<button
                  class="tile ${this.selected === f.path ? 'active' : ''} ${fresh.has(f.path) ? 'fresh' : ''}"
                  title=${new Date(f.modified * 1000).toLocaleString()}
                  @click=${() => void this.#select(f)}
                >
                  <span class="tile-name">${f.name}</span>
                  <span class="row">
                    <span class="tag">${this.t(`shaketune.folder.${f.folder}`)}</span>
                    ${f.axis ? html`<span class="tag">${f.axis}</span>` : nothing}
                    ${fresh.has(f.path) ? html`<span class="tag new">${this.t('shaketune.results.new')}</span>` : nothing}
                  </span>
                </button>`,
              )}
            </div>`}
        ${this.previewUrl
          ? html`<img class="preview" src=${this.previewUrl} alt=${this.selected ?? ''} @click=${this.#openLightbox} />
              <dialog @click=${(e: MouseEvent) => e.target === e.currentTarget && (e.currentTarget as HTMLDialogElement).close()}>
                <img
                  class=${this.full ? 'full' : 'fit'}
                  src=${this.previewUrl}
                  alt=${this.selected ?? ''}
                  @click=${() => (this.full = !this.full)}
                />
              </dialog>`
          : nothing}
      `;
    }

    return html`
      <section class="panel">
        <header class="panel-header">
          <span class="panel-title">${this.t('shaketune.results.title')}</span>
          ${config.resultsPath ? html`<span class="chip mono" title=${config.resultsPath}>${config.resultsPath}</span>` : nothing}
          <button
            class="icon-btn"
            title=${this.t('shaketune.common.refresh')}
            aria-label=${this.t('shaketune.common.refresh')}
            @click=${() => void this.#ctl.refreshFiles()}
          >⟳</button>
        </header>
        <div class="panel-body">${body}</div>
      </section>
    `;
  }
}
