import { parseMacro, validMacroName, validVariableName, type MacroDocument, type MacroVariable } from './model';
import type { BuilderApi, BuilderSession } from './session';
import type { MacroWorkspace } from './workspace';

/** The persistent overlay is inert until Config invokes its action. */
export class MacroBuilderDialog extends HTMLElement {
  private modal: HTMLDialogElement | null = null;
  private session: BuilderSession | null = null;
  private api: BuilderApi | null = null;
  private model: MacroDocument | null = null;
  private canvas: HTMLElement | null = null;
  private builder: MacroWorkspace | null = null;
  private nameInput: HTMLInputElement | null = null;
  private error: HTMLElement | null = null;
  private applyButton: HTMLButtonElement | null = null;
  private toolboxButton: HTMLButtonElement | null = null;
  private variables: MacroVariable[] = [];
  private suggestionPanel: HTMLElement | null = null;
  private activeField: HTMLInputElement | HTMLTextAreaElement | null = null;
  private suggestionItems: ReturnType<NonNullable<BuilderSession['suggest']>> = [];
  private suggestionIndex = 0;
  private loadSequence = 0;
  private compact = false;
  private stale = false;
  private stopThemeChange: (() => void) | null = null;

  connectedCallback(): void {
    if (this.modal) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    this.append(style);
    const modal = document.createElement('dialog');
    modal.className = 'macro-builder-modal';
    modal.setAttribute('aria-modal', 'true');
    // This is an editor-local keymap, so L must not toggle the host sidebar.
    modal.dataset.hotkeyEditorOwner = 'tessera/macro-builder';
    modal.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
    modal.addEventListener('keydown', this.onInsertShortcut, true);
    this.modal = modal;
    this.append(modal);
  }

  disconnectedCallback(): void {
    this.close();
    this.modal = null;
  }

  private t(key: string): string { return this.api?.i18n.t(`macroBuilder.${key}`) ?? key; }

  private button(label: string, click: () => void, className = ''): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = className;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', click);
    return button;
  }

  /** Load Blockly after the first open, keeping the unopened plugin inexpensive. */
  async open(session: BuilderSession, api: BuilderApi): Promise<void> {
    this.close();
    this.session = session;
    this.api = api;
    // Blockly's SVG styles are resolved colors, so CSS token changes need a redraw.
    this.stopThemeChange = api.onThemeChange(() => this.builder?.updateTheme());
    this.stale = false;
    const sequence = ++this.loadSequence;
    this.model = parseMacro(session.section?.text ?? null, session.macroNames);
    this.variables = this.model.variables.map((item) => ({ ...item }));
    const modal = this.modal;
    if (!modal || !this.model) return;
    modal.replaceChildren();
    modal.dir = document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr';
    modal.setAttribute('aria-label', this.t('title'));

    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = `${this.t('title')} · ${session.path}`;
    title.dir = 'auto';
    const close = this.button('×', () => this.close());
    close.setAttribute('aria-label', this.t('cancel'));
    header.append(title, close);
    modal.append(header);

    const nameRow = document.createElement('div');
    nameRow.className = 'mb-name-row';
    const label = document.createElement('label');
    label.textContent = this.t('name');
    const name = document.createElement('input');
    name.type = 'text';
    name.dir = 'ltr';
    name.value = this.model.name;
    name.setAttribute('aria-label', this.t('name'));
    name.addEventListener('input', () => this.validate());
    this.nameInput = name;
    label.append(name);
    nameRow.append(label);
    const variableArea = document.createElement('div');
    variableArea.className = 'mb-variables';
    const variableTitle = document.createElement('strong');
    variableTitle.textContent = this.t('variables');
    const variableRows = document.createElement('div');
    variableRows.className = 'mb-variable-rows';
    const drawVariables = (): void => {
      variableRows.replaceChildren();
      for (const item of this.variables) {
        const row = document.createElement('div');
        row.className = 'mb-variable-row';
        const key = document.createElement('input');
        key.dir = 'ltr';
        key.value = item.name;
        key.placeholder = this.t('variableName');
        key.setAttribute('aria-label', this.t('variableName'));
        key.addEventListener('input', () => { item.name = key.value; this.validate(); });
        const value = document.createElement('input');
        value.dir = 'ltr';
        value.value = item.value;
        value.placeholder = this.t('initialValue');
        value.setAttribute('aria-label', this.t('initialValue'));
        value.addEventListener('input', () => { item.value = value.value; this.validate(); });
        row.append(key, value, this.button(this.t('removeVariable'), () => {
          this.variables = this.variables.filter((entry) => entry !== item);
          drawVariables();
          this.validate();
        }));
        variableRows.append(row);
      }
    };
    const addVariable = this.button(this.t('addVariable'), () => {
      this.variables.push({ name: '', value: '', source: '', from: -1 });
      drawVariables();
      variableRows.querySelector<HTMLInputElement>('.mb-variable-row:last-child input')?.focus();
      this.validate();
    });
    variableArea.append(variableTitle, variableRows, addVariable);
    drawVariables();
    nameRow.append(variableArea);
    modal.append(nameRow);

    const toolbar = document.createElement('div');
    toolbar.className = 'mb-toolbar';
    this.toolboxButton = this.button(this.t('blocks'), () => this.toggleToolbox());
    toolbar.append(this.toolboxButton,
      this.button(this.t('moveUp'), () => this.moveSelected(-1)),
      this.button(this.t('moveDown'), () => this.moveSelected(1)),
      this.button(this.t('delete'), () => this.builder?.selected()?.dispose(true)),
      this.button(this.t('rawEdit'), () => this.showRawEditor()));
    const hint = document.createElement('input');
    hint.setAttribute('aria-label', this.t('suggestions'));
    hint.placeholder = this.t('suggestions');
    hint.dir = 'ltr';
    hint.setAttribute('list', 'macro-builder-hints');
    const list = document.createElement('datalist');
    list.id = 'macro-builder-hints';
    for (const value of [...session.commands.map((item) => item.name), ...session.macroNames,
      ...session.commands.flatMap((item) => item.params), ...session.objects]) {
      const option = document.createElement('option');
      option.value = value;
      list.append(option);
    }
    hint.addEventListener('change', () => {
      const block = this.builder?.selected();
      if (block && hint.value) block.setFieldValue(hint.value, 'VALUE');
      hint.value = '';
    });
    toolbar.append(hint, list);
    modal.append(toolbar);

    const canvas = document.createElement('div');
    canvas.className = 'mb-canvas';
    canvas.setAttribute('role', 'region');
    canvas.setAttribute('aria-label', this.t('blocks'));
    canvas.setAttribute('aria-keyshortcuts', 'C M Alt+C L');
    canvas.tabIndex = 0;
    canvas.textContent = this.t('loading');
    this.canvas = canvas;
    modal.append(canvas);
    const suggestionPanel = document.createElement('div');
    suggestionPanel.className = 'mb-suggestions';
    suggestionPanel.hidden = true;
    this.suggestionPanel = suggestionPanel;
    modal.append(suggestionPanel);
    const error = document.createElement('p');
    error.className = 'mb-error';
    error.setAttribute('role', 'alert');
    this.error = error;
    modal.append(error);
    const footer = document.createElement('footer');
    this.applyButton = this.button(this.t('apply'), () => this.apply(), 'primary');
    footer.append(this.button(this.t('cancel'), () => this.close()), this.applyButton);
    modal.append(footer);
    modal.showModal();
    document.addEventListener('input', this.onFieldInput, true);
    document.addEventListener('focusin', this.onFieldFocus, true);
    document.addEventListener('macro-builder-caret', this.onFieldCaret, true);
    document.addEventListener('pointerup', this.onFieldPointerUp, true);
    document.addEventListener('keyup', this.onFieldKeyup, true);
    document.addEventListener('keydown', this.onFieldKeydown, true);
    this.validate();

    try {
      const { MacroWorkspace } = await import('./workspace');
      if (sequence !== this.loadSequence || !this.modal?.open || !this.model) return;
      canvas.replaceChildren();
      this.builder = new MacroWorkspace(canvas, this.model, session, {
        command: this.t('command'), call: this.t('call'), assign: this.t('assign'),
        comment: this.t('comment'), raw: this.t('raw'), if: this.t('if'), for: this.t('for'),
        set_macro_var: this.t('setMacroVar'), save_var: this.t('saveVar'),
        then: this.t('then'), else: this.t('else'), do: this.t('do'),
      }, modal.dir === 'rtl');
      this.compact = window.matchMedia('(max-width: 768px)').matches;
      this.builder.setToolboxVisible(!this.compact);
      const blockly = await import('blockly/core');
      blockly.svgResize(this.builder.workspace);
      this.validate();
    } catch (error) {
      console.error('[macro-builder] Blockly could not initialize', error);
      if (sequence === this.loadSequence) this.showError(this.t('loadError'));
    }
  }

  private validate(): void {
    const name = this.nameInput?.value.trim() ?? '';
    const nameOkay = !!this.model && !!this.session && validMacroName(name, this.session.macroNames, this.model.name);
    const names = this.variables.map((item) => item.name);
    const variablesOkay = this.variables.every((item) => validVariableName(item.name) && item.value.trim() !== '') &&
      new Set(names).size === names.length;
    const okay = nameOkay && variablesOkay;
    if (this.applyButton) this.applyButton.disabled = !okay || !this.builder;
    if (!nameOkay) this.showError(this.t('invalidName'));
    else if (!variablesOkay) this.showError(this.t('invalidVariable'));
    else this.showError('');
  }

  /** Keep Blockly's editor and its suggestions readable for long expressions. */
  private resizeField(field: HTMLInputElement | HTMLTextAreaElement): void {
    const canvas = document.createElement('canvas');
    const measure = canvas.getContext('2d');
    if (!measure) return;
    measure.font = getComputedStyle(field).font;
    const longest = field.value.split(/\r?\n/).reduce((max, line) =>
      Math.max(max, measure.measureText(line).width), 0);
    field.style.width = `${Math.min(window.innerWidth - 48, Math.max(120, Math.ceil(longest + 32)))}px`;
    if (field instanceof HTMLTextAreaElement) {
      field.style.height = 'auto';
      field.style.height = `${Math.min(window.innerHeight / 2, field.scrollHeight)}px`;
    }
  }

  private isBlocklyField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
    return (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
      target.classList.contains('blocklyHtmlInput');
  }

  private onFieldFocus = (event: FocusEvent): void => {
    if (this.isBlocklyField(event.target)) this.updateSuggestions(event.target);
  };

  private onFieldInput = (event: Event): void => {
    if (this.isBlocklyField(event.target)) this.updateSuggestions(event.target);
  };

  /** Cursor movement can enter a parameter value without changing the command text. */
  private onFieldCaret = (event: Event): void => {
    if (this.isBlocklyField(event.target)) this.updateSuggestions(event.target);
  };

  private onFieldPointerUp = (event: PointerEvent): void => {
    if (this.isBlocklyField(event.target)) this.updateSuggestions(event.target);
  };

  private onFieldKeyup = (event: KeyboardEvent): void => {
    if (this.isBlocklyField(event.target) &&
      ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) this.updateSuggestions(event.target);
  };

  /** Config returns the same command and Jinja candidates used by its text editor. */
  private updateSuggestions(field: HTMLInputElement | HTMLTextAreaElement): void {
    this.activeField = field;
    this.resizeField(field);
    const panel = this.suggestionPanel;
    const suggest = this.session?.suggest;
    if (!panel || !suggest) return;
    // Keep every match from Config; the panel scrolls instead of hiding later candidates.
    this.suggestionItems = suggest(field.value, field.selectionStart ?? field.value.length,
      this.variables, this.nameInput?.value.trim() ?? '');
    this.suggestionIndex = 0;
    panel.replaceChildren();
    for (const [index, item] of this.suggestionItems.entries()) {
      const option = this.button(item.label, () => this.acceptSuggestion(index));
      option.className = 'mb-suggestion';
      // Keep Blockly's widget editor mounted until the chosen text reaches its field.
      option.addEventListener('pointerdown', (event) => event.preventDefault());
      option.setAttribute('aria-selected', String(index === this.suggestionIndex));
      if (item.detail) {
        const detail = document.createElement('small');
        detail.className = 'mb-suggestion-detail';
        detail.dir = 'ltr';
        detail.textContent = item.detail;
        option.append(detail);
      }
      panel.append(option);
    }
    panel.hidden = this.suggestionItems.length === 0;
    if (!panel.hidden) {
      const rect = field.getBoundingClientRect();
      const rtl = this.modal?.dir === 'rtl';
      panel.style.insetInlineStart = `${Math.max(8, Math.min(window.innerWidth - 300,
        rtl ? window.innerWidth - rect.right : rect.left))}px`;
      panel.style.top = `${Math.min(window.innerHeight - 180, rect.bottom + 4)}px`;
    }
  }

  private acceptSuggestion(index: number): void {
    const field = this.activeField;
    const item = this.suggestionItems[index];
    if (!field || !item) return;
    field.setRangeText(item.insert, item.from, field.selectionStart ?? field.value.length, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.focus();
    if (this.suggestionPanel) this.suggestionPanel.hidden = true;
  }

  private onFieldKeydown = (event: KeyboardEvent): void => {
    if (event.target !== this.activeField || this.suggestionPanel?.hidden || !this.suggestionItems.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.suggestionIndex = (this.suggestionIndex + (event.key === 'ArrowDown' ? 1 : -1) +
        this.suggestionItems.length) % this.suggestionItems.length;
      this.suggestionPanel?.querySelectorAll('button').forEach((option, index) =>
        option.setAttribute('aria-selected', String(index === this.suggestionIndex)));
      this.suggestionPanel?.querySelectorAll('button')[this.suggestionIndex]
        ?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.acceptSuggestion(this.suggestionIndex);
    } else if (event.key === 'Escape') {
      if (this.suggestionPanel) this.suggestionPanel.hidden = true;
    }
  };

  /** Physical keys work under either keyboard layout and never replace text being edited. */
  private onInsertShortcut = (event: KeyboardEvent): void => {
    if (!this.modal?.open || !this.builder || event.defaultPrevented || event.repeat || event.isComposing ||
      event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable], [role="textbox"]')) return;
    const kind = event.code === 'KeyC' ? event.altKey ? 'if' : 'command'
      : !event.altKey && event.code === 'KeyM' ? 'call'
        : !event.altKey && event.code === 'KeyL' ? 'for' : null;
    if (!kind) return;
    event.preventDefault();
    event.stopPropagation();
    this.builder.insertBlock(kind);
  };

  private showError(message: string): void {
    if (this.error) this.error.textContent = message;
  }

  private toggleToolbox(): void {
    if (!this.builder) return;
    this.compact = !this.compact;
    this.builder.setToolboxVisible(!this.compact);
  }

  /** Reconnect a statement chain so touch users can reorder without dragging. */
  private moveSelected(direction: -1 | 1): void {
    const selected = this.builder?.selected();
    if (!selected || !this.builder) return;
    let first = selected;
    while (first.getPreviousBlock()) first = first.getPreviousBlock()!;
    const blocks: typeof first[] = [];
    for (let block: typeof first | null = first; block; block = block.getNextBlock()) blocks.push(block);
    const index = blocks.indexOf(selected);
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const parent = first.previousConnection?.targetConnection ?? null;
    for (const block of blocks) block.previousConnection?.disconnect();
    [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
    if (parent) parent.connect(blocks[0]!.previousConnection!);
    for (let at = 1; at < blocks.length; at++) blocks[at - 1]!.nextConnection?.connect(blocks[at]!.previousConnection!);
    this.builder.workspace.cleanUp();
  }

  private showRawEditor(): void {
    const selected = this.builder?.selected();
    if (!selected || selected.type !== 'mb_raw' || !this.modal) return;
    const wrap = document.createElement('div');
    wrap.className = 'mb-raw-editor';
    const textarea = document.createElement('textarea');
    textarea.dir = 'ltr';
    textarea.value = String(selected.getFieldValue('VALUE') ?? '');
    wrap.append(textarea, this.button(this.t('rawSave'), () => {
      this.builder?.editSelectedRaw(textarea.value);
      wrap.remove();
    }), this.button(this.t('rawCancel'), () => wrap.remove()));
    this.modal.append(wrap);
    textarea.focus();
  }

  private apply(): void {
    if (this.stale) { this.close(); return; }
    if (!this.builder || !this.session || !this.model || !this.nameInput) return;
    const name = this.nameInput.value.trim();
    if (!validMacroName(name, this.session.macroNames, this.model.name)) { this.validate(); return; }
    if (this.variables.some((item) => !validVariableName(item.name) || !item.value.trim())) { this.validate(); return; }
    const result = this.session.applyEdit(this.builder.serialize(name, this.variables));
    if (result === 'applied') this.close();
    else {
      this.stale = true;
      this.showError(this.t('stale'));
      if (this.applyButton) {
        this.applyButton.disabled = false;
        this.applyButton.textContent = this.t('closeReopen');
      }
    }
  }

  /** Cancel does not touch Config's buffer. */
  close(): void {
    document.removeEventListener('input', this.onFieldInput, true);
    document.removeEventListener('focusin', this.onFieldFocus, true);
    document.removeEventListener('macro-builder-caret', this.onFieldCaret, true);
    document.removeEventListener('pointerup', this.onFieldPointerUp, true);
    document.removeEventListener('keyup', this.onFieldKeyup, true);
    document.removeEventListener('keydown', this.onFieldKeydown, true);
    this.activeField = null;
    this.suggestionPanel = null;
    this.loadSequence++;
    this.builder?.dispose();
    this.builder = null;
    this.stopThemeChange?.();
    this.stopThemeChange = null;
    this.session = null;
    this.model = null;
    if (this.modal?.open) this.modal.close();
  }
}

// A full viewport dialog leaves the canvas the available space in either direction.
const CSS = `
.macro-builder-modal { position: fixed; inset-block: 0; inset-inline: 0; width: 100vw; height: 100vh; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0; border-radius: 0; background: var(--bg-surface); color: var(--text-primary); overflow: hidden; color-scheme: light; }
:root[data-theme="dark"] .macro-builder-modal { color-scheme: dark; }
.macro-builder-modal[open] { display: flex; flex-direction: column; }
.macro-builder-modal::backdrop { background: var(--bg-overlay); }
.macro-builder-modal header, .macro-builder-modal footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border-block-end: 1px solid var(--border-color); }
.macro-builder-modal footer { border-block-start: 1px solid var(--border-color); border-block-end: 0; justify-content: flex-end; }
.macro-builder-modal h2 { font-size: var(--font-size-md); min-width: 0; overflow-wrap: anywhere; margin: 0; }
.macro-builder-modal button { min-width: 44px; min-height: 44px; padding: var(--space-xs) var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface-hover); color: var(--text-primary); cursor: pointer; }
.macro-builder-modal button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
.macro-builder-modal button:disabled { opacity: .5; cursor: default; }
.mb-name-row, .mb-toolbar { padding: var(--space-xs) var(--space-md); display: flex; align-items: center; gap: var(--space-xs); flex-wrap: wrap; }
.mb-name-row label { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
/* Variable rows wrap independently so long Python literals do not widen the dialog. */
.mb-variables { display: grid; gap: var(--space-xs); flex: 1 1 360px; min-width: 0; }
.mb-variable-rows { display: grid; gap: var(--space-xs); }
.mb-variable-row { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
.mb-variable-row input:first-child { flex: 1 1 130px; }
.mb-variable-row input:nth-child(2) { flex: 2 1 180px; }
.mb-variables > button { justify-self: start; }
.macro-builder-modal input, .macro-builder-modal textarea { min-height: 40px; min-width: 0; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-app); color: var(--text-primary); padding: var(--space-xs); font: inherit; }
.mb-toolbar input { flex: 1 1 180px; }
.mb-canvas { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; background: var(--bg-app); }
.mb-error { min-height: 1.3em; margin: 0; padding-inline: var(--space-md); color: var(--danger); overflow-wrap: anywhere; }
.mb-suggestions { position: fixed; z-index: 10; width: min(300px, calc(100vw - 16px)); max-height: 180px; overflow: auto; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface); box-shadow: var(--shadow-lg); }
.mb-suggestions[hidden] { display: none; }
.mb-suggestions button { display: block; width: 100%; min-height: 36px; border: 0; border-radius: 0; text-align: start; overflow-wrap: anywhere; }
.mb-suggestions button[aria-selected="true"] { background: var(--bg-surface-active); }
.mb-suggestion-detail { margin-inline-start: var(--space-xs); color: var(--text-muted); font-family: monospace; }
.mb-raw-editor { position: absolute; inset-inline: var(--space-md); inset-block-end: 72px; z-index: 2; padding: var(--space-sm); border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-surface); display: flex; gap: var(--space-xs); flex-wrap: wrap; }
.mb-raw-editor textarea { width: 100%; min-height: 110px; font-family: monospace; resize: vertical; white-space: pre; }
.macro-builder-modal .blocklyText { unicode-bidi: plaintext; }
/* Blockly mounts its active field outside the canvas; keep it in the host's color scheme. */
.macro-builder-modal .blocklyHtmlInput, .macro-builder-widget .blocklyHtmlInput { background: var(--bg-surface); color: var(--text-primary); border-color: var(--border-focus); }
.macro-builder-widget { color-scheme: light; }
:root[data-theme="dark"] .macro-builder-widget { color-scheme: dark; }
/* Blockly's empty SVG layers sit above the editable blocks in this native dialog. */
.macro-builder-modal .blocklyAnimationLayer, .macro-builder-modal .blocklyBlockDragSurface { pointer-events: none; }
@media (max-width: 768px) { .mb-toolbar { gap: 4px; } .mb-toolbar button { flex: 1 1 auto; } .mb-name-row input { width: min(100%, 260px); } }
`;
