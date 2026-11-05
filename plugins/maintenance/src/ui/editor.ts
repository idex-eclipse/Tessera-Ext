import { css, html, nothing, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import { validateGraph } from '../core/graph';
import type { MaintenanceRuntime } from '../core/runtime';
import type { Outcome, Task, Unit } from '../core/types';
import { UNITS } from '../core/types';
import { outcomeLabel, taskName } from './format';
import { styles } from './styles';

/**
 * <tessera-maint-editor> - a modal dialog that edits one task, or creates a custom one.
 *
 * It uses a native <dialog> with showModal(): the dialog lands in the browser's top layer,
 * so the host page cannot clip it (the tab is mounted inside the Machine page). The draft
 * is a copy; nothing reaches the runtime until "Save", and saving pins the task
 * (`customized`) so the first-run wizard no longer overwrites it.
 */
export class MaintEditor extends TesseraElement {
  static override styles = [
    styles,
    css`
      dialog {
        inline-size: min(640px, calc(100vw - 2 * var(--space-md)));
        max-block-size: calc(100dvh - 2 * var(--space-md));
        padding: 0;
        border: 1px solid var(--border-color);
        border-radius: var(--radius-md);
        background: var(--bg-surface);
        color: var(--text-primary);
        font-family: var(--font-family, inherit);
        overflow: auto;
      }
      dialog::backdrop {
        background: rgba(0, 0, 0, 0.5);
      }
      label.check {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-block-size: 32px;
        overflow-wrap: anywhere;
      }
      textarea {
        min-width: 0;
        min-block-size: 64px;
        padding: var(--space-xs) var(--space-sm);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        background: var(--bg-surface);
        color: var(--text-primary);
        font: inherit;
        font-size: var(--font-size-sm);
        resize: vertical;
      }
      .outcome {
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        padding: var(--space-sm);
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      .targets {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
        gap: 2px var(--space-sm);
      }
    `,
  ];

  static override properties = {
    ...TesseraElement.properties,
    runtime: { attribute: false },
    draft: { state: true },
    creating: { state: true },
    newName: { state: true },
    newKind: { state: true },
  };

  declare runtime: MaintenanceRuntime | null;
  /** The copy being edited; null while the dialog is closed or in the "new task" step. */
  declare draft: Task | null;
  declare creating: boolean;
  declare newName: string;
  declare newKind: 'interval' | 'followup';

  constructor() {
    super();
    this.runtime = null;
    this.draft = null;
    this.creating = false;
    this.newName = '';
    this.newKind = 'interval';
  }

  get #dialog(): HTMLDialogElement | null {
    return this.renderRoot.querySelector('dialog');
  }

  /** Opens the dialog for an existing task. */
  edit(id: string): void {
    const task = this.runtime?.state?.tasks.find((t) => t.id === id);
    if (!task) return;
    this.draft = structuredClone(task);
    this.creating = false;
    void this.updateComplete.then(() => this.#dialog?.showModal());
  }

  /** Opens the dialog on the first step of creating a custom task. */
  create(): void {
    this.draft = null;
    this.creating = true;
    this.newName = '';
    this.newKind = 'interval';
    void this.updateComplete.then(() => this.#dialog?.showModal());
  }

  #close(): void {
    this.#dialog?.close();
    this.draft = null;
    this.creating = false;
  }

  #patch(fn: (d: Task) => void): void {
    if (!this.draft) return;
    const next = structuredClone(this.draft);
    fn(next);
    this.draft = next;
  }

  #numberField(unit: Unit, obj: 'intervals' | 'lead' | 'adjust'): TemplateResult {
    const d = this.draft!;
    const v = d[obj === 'adjust' ? 'counter' : obj];
    const value = obj === 'adjust' ? (d.counter.adjust[unit] ?? '') : ((v as Record<string, number | undefined>)[unit] ?? '');
    return html`
      <label class="field">
        <span class="field-label">${this.t(`maintenance.unitName.${unit}`)}</span>
        <input
          type="number"
          step="any"
          .value=${String(value)}
          @input=${(e: Event) => {
            const raw = (e.target as HTMLInputElement).value;
            const n = raw === '' ? undefined : Number(raw);
            this.#patch((t) => {
              const target = obj === 'adjust' ? t.counter.adjust : t[obj];
              if (n === undefined || !Number.isFinite(n)) delete target[unit];
              else target[unit] = n;
            });
          }}
        />
      </label>
    `;
  }

  #save(): void {
    const d = this.draft;
    if (!d || !this.runtime) return;
    // An interval task without any interval would never be due: keep what it had.
    this.runtime.updateTask(d.id, () => d);
    this.#close();
  }

  #delete(): void {
    if (!this.draft || !this.runtime) return;
    if (!window.confirm(this.t('maintenance.editor.deleteConfirm'))) return;
    this.runtime.deleteTask(this.draft.id);
    this.#close();
  }

  #createTask(): void {
    const name = this.newName.trim();
    if (!name || !this.runtime) return;
    const id = this.runtime.addCustomTask(name, this.newKind);
    this.creating = false;
    if (id) this.edit(id);
  }

  #renderNew(): TemplateResult {
    const tr = (k: string): string => this.t(k);
    return html`
      <div class="panel-header"><span class="panel-title">${tr('maintenance.editor.newTitle')}</span></div>
      <div class="panel-body">
        <label class="field">
          <span class="field-label">${tr('maintenance.editor.name')}</span>
          <input .value=${this.newName} @input=${(e: Event) => (this.newName = (e.target as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span class="field-label">${tr('maintenance.editor.kind')}</span>
          <select .value=${this.newKind} @change=${(e: Event) => (this.newKind = (e.target as HTMLSelectElement).value as 'interval' | 'followup')}>
            <option value="interval">${tr('maintenance.editor.kindInterval')}</option>
            <option value="followup">${tr('maintenance.editor.kindFollowup')}</option>
          </select>
        </label>
        <div class="row">
          <button class="primary" ?disabled=${!this.newName.trim()} @click=${() => this.#createTask()}>${tr('maintenance.common.create')}</button>
          <button @click=${() => this.#close()}>${tr('maintenance.common.cancel')}</button>
        </div>
      </div>
    `;
  }

  #renderOutcome(o: Outcome, index: number, d: Task): TemplateResult {
    const tr = (k: string, p?: Record<string, string | number>): string => this.t(k, p);
    const custom = d.defId === 'custom';
    const others = (this.runtime?.state?.tasks ?? []).filter((t) => t.kind !== 'precheck');
    return html`
      <div class="outcome">
        <div class="row">
          ${custom
            ? html`<input
                class="grow"
                aria-label=${tr('maintenance.editor.outcomeLabel')}
                placeholder=${tr('maintenance.editor.outcomeLabel')}
                .value=${o.label ?? ''}
                @input=${(e: Event) => this.#patch((t) => (t.outcomes[index]!.label = (e.target as HTMLInputElement).value))}
              />`
            : html`<strong class="grow">${outcomeLabel(tr, o)}</strong>`}
          ${custom && d.outcomes.length > 1
            ? html`<button class="small danger" @click=${() => this.#patch((t) => t.outcomes.splice(index, 1))}>${tr('maintenance.editor.removeOutcome')}</button>`
            : nothing}
        </div>
        <label class="check">
          <input type="checkbox" .checked=${o.resetsTimer} @change=${(e: Event) => this.#patch((t) => (t.outcomes[index]!.resetsTimer = (e.target as HTMLInputElement).checked))} />
          ${tr('maintenance.editor.resetsTimer')}
        </label>
        ${d.kind === 'followup'
          ? html`<label class="check">
              <input type="checkbox" .checked=${!!o.completes} @change=${(e: Event) => this.#patch((t) => (t.outcomes[index]!.completes = (e.target as HTMLInputElement).checked))} />
              ${tr('maintenance.editor.completes')}
            </label>`
          : nothing}
        <span class="field-label">${tr('maintenance.editor.triggers')}</span>
        <div class="targets">
          ${others.map(
            (t) => html`<label class="check">
              <input
                type="checkbox"
                .checked=${o.activates.includes(t.id)}
                @change=${(e: Event) =>
                  this.#patch((x) => {
                    const list = x.outcomes[index]!.activates;
                    const on = (e.target as HTMLInputElement).checked;
                    x.outcomes[index]!.activates = on ? [...list, t.id] : list.filter((id) => id !== t.id);
                  })}
              />
              <span>${taskName(tr, t)}${t.tool ? ` (${t.tool})` : ''}</span>
            </label>`,
          )}
        </div>
      </div>
    `;
  }

  #renderEdit(d: Task): TemplateResult {
    const tr = (k: string, p?: Record<string, string | number>): string => this.t(k, p);
    const custom = d.defId === 'custom';
    // A circle of links is allowed (every step waits for a person), but worth pointing out.
    const draftState = this.runtime?.state ? { tasks: this.runtime.state.tasks.map((t) => (t.id === d.id ? d : t)) } : null;
    const hasCycle = draftState ? validateGraph(draftState).some((i) => i.code === 'cycle') : false;

    return html`
      <div class="panel-header"><span class="panel-title">${tr('maintenance.editor.title')}: ${taskName(tr, d)}</span></div>
      <div class="panel-body">
        <label class="check">
          <input type="checkbox" .checked=${d.enabled} @change=${(e: Event) => this.#patch((t) => (t.enabled = (e.target as HTMLInputElement).checked))} />
          ${tr('maintenance.editor.enabled')}
        </label>
        ${custom
          ? html`
              <label class="field">
                <span class="field-label">${tr('maintenance.editor.name')}</span>
                <input .value=${d.name ?? ''} @input=${(e: Event) => this.#patch((t) => (t.name = (e.target as HTMLInputElement).value))} />
              </label>
              <label class="field">
                <span class="field-label">${tr('maintenance.editor.instruction')}</span>
                <textarea .value=${d.instruction ?? ''} @input=${(e: Event) => this.#patch((t) => (t.instruction = (e.target as HTMLTextAreaElement).value))}></textarea>
              </label>
            `
          : nothing}
        ${d.kind === 'interval'
          ? html`
              <span class="field-label">${tr('maintenance.editor.intervals')}</span>
              <div class="fields">${UNITS.map((u) => this.#numberField(u, 'intervals'))}</div>
              <span class="field-label">${tr('maintenance.editor.lead')}</span>
              <div class="fields">${UNITS.map((u) => this.#numberField(u, 'lead'))}</div>
              <p class="muted">${tr('maintenance.editor.leadHint')}</p>
              <span class="field-label">${tr('maintenance.editor.adjust')}</span>
              <div class="fields">${UNITS.filter((u) => u !== 'days').map((u) => this.#numberField(u, 'adjust'))}</div>
              <p class="muted">${tr('maintenance.editor.adjustHint')}</p>
            `
          : nothing}
        <label class="check">
          <input type="checkbox" .checked=${d.guard} @change=${(e: Event) => this.#patch((t) => (t.guard = (e.target as HTMLInputElement).checked))} />
          ${tr('maintenance.editor.guard')}
        </label>
        <label class="check">
          <input type="checkbox" .checked=${d.notify} @change=${(e: Event) => this.#patch((t) => (t.notify = (e.target as HTMLInputElement).checked))} />
          ${tr('maintenance.editor.notify')}
        </label>

        <span class="field-label">${tr('maintenance.editor.outcomes')}</span>
        ${d.outcomes.map((o, i) => this.#renderOutcome(o, i, d))}
        ${custom
          ? html`<div class="row">
              <button
                class="small"
                @click=${() =>
                  this.#patch((t) =>
                    t.outcomes.push({ id: `r${Date.now().toString(36)}`, label: '', resetsTimer: t.kind === 'interval', activates: [] }),
                  )}
              >
                ${tr('maintenance.editor.addOutcome')}
              </button>
            </div>`
          : nothing}
        ${hasCycle ? html`<p class="warn">${tr('maintenance.editor.cycle')}</p>` : nothing}

        <div class="row">
          <button class="primary" @click=${() => this.#save()}>${tr('maintenance.common.save')}</button>
          <button @click=${() => this.#close()}>${tr('maintenance.common.cancel')}</button>
          <span class="grow"></span>
          ${custom ? html`<button class="danger" @click=${() => this.#delete()}>${tr('maintenance.common.delete')}</button>` : nothing}
        </div>
      </div>
    `;
  }

  override render(): TemplateResult {
    return html`<dialog @close=${() => { this.draft = null; this.creating = false; }}>
      ${this.creating ? this.#renderNew() : this.draft ? this.#renderEdit(this.draft) : nothing}
    </dialog>`;
  }
}
