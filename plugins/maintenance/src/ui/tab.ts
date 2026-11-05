import { css, html, nothing, type TemplateResult } from 'lit';

import { RuntimeElement } from '../base-element';
import { byUrgency, summarize } from '../core/evaluate';
import type { JournalEntry } from '../core/types';
import type { MaintEditor } from './editor';
import { outcomeLabel, taskName } from './format';
import { statusStyles, styles } from './styles';

type Section = 'tasks' | 'chains' | 'journal' | 'settings';

/**
 * <tessera-maintenance-tab> - the Maintenance tab of the Machine page.
 *
 * It contributes to the extension point `@core/system#tabs` (manifest.json). Before the
 * first-run wizard is finished it shows the wizard; afterwards three sections: the task
 * cards (most urgent first), the journal and the settings.
 */
export class MaintenanceTab extends RuntimeElement {
  static override styles = [
    styles,
    statusStyles,
    css`
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
        gap: var(--space-md);
        align-items: start;
      }
      /* The selected section looks like a primary button, the others like neutral ones. */
      .nav button[aria-pressed='true'] {
        background: var(--accent);
        color: #fff;
        font-weight: 600;
      }
      table {
        inline-size: 100%;
        border-collapse: collapse;
        font-size: var(--font-size-sm);
      }
      th,
      td {
        text-align: start;
        padding: var(--space-xs) var(--space-sm);
        border-block-end: 1px solid var(--border-color);
        vertical-align: top;
        overflow-wrap: anywhere;
      }
      label.check {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-block-size: 32px;
      }
      .journal-wrap {
        overflow-x: auto;
      }
    `,
  ];

  static override properties = {
    ...RuntimeElement.properties,
    section: { state: true },
    rerun: { state: true },
    notice: { state: true },
  };

  declare section: Section;
  declare rerun: boolean;
  declare notice: string;

  constructor() {
    super();
    this.section = 'tasks';
    this.rerun = false;
    this.notice = '';
  }

  get #editor(): MaintEditor | null {
    return this.renderRoot.querySelector('tessera-maint-editor');
  }

  #onPressed(e: CustomEvent<{ triggered: string[] }>): void {
    const ids = e.detail.triggered;
    const tasks = this.runtime?.state?.tasks ?? [];
    this.notice = ids.length
      ? this.t('maintenance.pressed', {
          names: ids.map((id) => tasks.find((t) => t.id === id)).filter((t) => !!t).map((t) => taskName((k, p) => this.t(k, p), t!)).join(', '),
        })
      : '';
  }

  #renderTasks(): TemplateResult {
    const rt = this.runtime!;
    const state = rt.state!;
    const tr = (k: string, p?: Record<string, string | number>): string => this.t(k, p);
    const rows = byUrgency(state, rt.evals);
    // Switched-off tasks (and timer tasks without any interval) get their own list below,
    // so they never mix with the live ones. A follow-up that is enabled but not requested
    // yet is not shown at all: it appears when another card asks for it.
    const off = state.tasks
      .filter((t) => !rows.some((r) => r.task.id === t.id) && (!t.enabled || t.kind === 'interval'))
      .map((task) => ({ task, evaluation: { taskId: task.id, status: 'off' as const, triggered: false, units: [] } }));
    const sum = summarize(rt.evals);
    const visible = rows;
    const card = ({ task, evaluation }: (typeof rows)[number]): TemplateResult =>
      html`<tessera-maint-card .api=${this.api} .runtime=${rt} .task=${task} .evaluation=${evaluation}></tessera-maint-card>`;
    const events = {
      pressed: (e: CustomEvent<{ triggered: string[] }>) => this.#onPressed(e),
      edit: (e: CustomEvent<{ id: string }>) => this.#editor?.edit(e.detail.id),
    };

    // Standard panels of the interface: the title at the start of the header, the actions
    // at the end (the header wraps and centres them on narrow widths, see .panel-meta).
    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${tr('maintenance.summary.activeTitle')}</span>
          <span class="panel-meta">
            ${sum.overdue > 0 ? html`<span class="chip overdue">${tr('maintenance.summary.overdue', { n: sum.overdue })}</span>` : nothing}
            ${sum.soon > 0 ? html`<span class="chip soon">${tr('maintenance.summary.soon', { n: sum.soon })}</span>` : nothing}
            ${sum.overdue + sum.soon === 0 ? html`<span class="chip live">${tr('maintenance.summary.allOk')}</span>` : nothing}
            <button class="primary" @click=${() => this.#editor?.create()}>${tr('maintenance.common.add')}</button>
          </span>
        </div>
        <div class="panel-body">
          ${this.notice ? html`<p class="ok">${this.notice}</p>` : nothing}
          ${visible.length === 0
            ? html`<p class="muted">${tr('maintenance.noTasks')}</p>`
            : html`<div class="cards" @pressed=${events.pressed} @edit-task=${events.edit}>${visible.map(card)}</div>`}
        </div>
      </section>
      ${off.length > 0
        ? html`<section class="panel">
            <div class="panel-header"><span class="panel-title">${tr('maintenance.summary.disabledTitle')}</span></div>
            <div class="panel-body">
              <div class="cards" @pressed=${events.pressed} @edit-task=${events.edit}>${off.map(card)}</div>
            </div>
          </section>`
        : nothing}
    `;
  }

  #renderJournal(): TemplateResult {
    const rt = this.runtime!;
    const tr = (k: string, p?: Record<string, string | number>): string => this.t(k, p);
    if (rt.journal.length === 0) return html`<p class="muted">${tr('maintenance.journal.empty')}</p>`;
    const locale = this.api?.i18n.locale;
    const when = (e: JournalEntry): string => new Date(e.at).toLocaleString(locale);
    const outcome = (e: JournalEntry): string => {
      const task = rt.state?.tasks.find((t) => t.id === e.taskId);
      const o = task?.outcomes.find((x) => x.id === e.outcomeId);
      if (o) return outcomeLabel(tr, o);
      // Lines that belong to no card (a print started with work overdue) are named by i18n.
      const key = `maintenance.journalEvent.${e.outcomeId}`;
      return tr(key) !== key ? tr(key) : e.outcomeId;
    };
    return html`
      <div class="row">
        <span class="grow"></span>
        <button class="small" @click=${() => this.#downloadCsv()}>${tr('maintenance.journal.export')}</button>
      </div>
      <div class="journal-wrap">
        <table>
          <tbody>
            ${rt.journal.map(
              (e) => html`<tr>
                <td class="ltr">${when(e)}</td>
                <td>${e.taskLabel}</td>
                <td>${outcome(e)}</td>
                <td>${e.note ?? ''}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  #downloadCsv(): void {
    const rt = this.runtime;
    if (!rt) return;
    const esc = (v: string): string => `"${v.replace(/"/g, '""')}"`;
    const lines = rt.journal.map((e) => [new Date(e.at).toISOString(), e.taskLabel, e.outcomeId, e.note ?? ''].map(esc).join(','));
    const blob = new Blob(['﻿', ['time,task,result,note', ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'maintenance-journal.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  #renderSettings(): TemplateResult {
    const rt = this.runtime!;
    const state = rt.state!;
    const tr = (k: string): string => this.t(k);
    const bed = state.tasks.find((t) => t.kind === 'precheck');
    return html`
      <div class="panel">
        <div class="panel-body">
          <label class="check">
            <input type="checkbox" .checked=${state.settings.notifications} @change=${(e: Event) => rt.updateSettings({ notifications: (e.target as HTMLInputElement).checked })} />
            <span><strong>${tr('maintenance.settings.notifications')}</strong><br /><span class="muted">${tr('maintenance.settings.notificationsHint')}</span></span>
          </label>
          <label class="check">
            <input type="checkbox" .checked=${state.settings.guard} @change=${(e: Event) => rt.updateSettings({ guard: (e.target as HTMLInputElement).checked })} />
            <span><strong>${tr('maintenance.settings.guard')}</strong><br /><span class="muted">${tr('maintenance.settings.guardHint')}</span></span>
          </label>
          ${bed
            ? html`<label class="check">
                <input
                  type="checkbox"
                  .checked=${bed.enabled}
                  @change=${(e: Event) => {
                    const on = (e.target as HTMLInputElement).checked;
                    rt.mutate((s) => ({ ...s, tasks: s.tasks.map((t) => (t.id === bed.id ? { ...t, enabled: on } : t)) }));
                  }}
                />
                <span><strong>${tr('maintenance.settings.bedCheck')}</strong><br /><span class="muted">${tr('maintenance.task.bed-check.why')}</span></span>
              </label>`
            : nothing}
          <div class="row"><button @click=${() => (this.rerun = true)}>${tr('maintenance.settings.wizard')}</button></div>
          <p class="muted">${tr('maintenance.settings.counters')}</p>
        </div>
      </div>
    `;
  }

  override render(): TemplateResult {
    const rt = this.runtime;
    if (!rt || !rt.state) return html`<p class="muted">${this.t('maintenance.loading')}</p>`;
    const tr = (k: string): string => this.t(k);

    if (!rt.state.onboarding.done || this.rerun) {
      return html`<tessera-maint-wizard
        .api=${this.api}
        .runtime=${rt}
        .rerun=${this.rerun}
        @wizard-done=${() => (this.rerun = false)}
      ></tessera-maint-wizard>`;
    }

    return html`
      <div class="row nav" role="group">
        ${(['tasks', 'chains', 'journal', 'settings'] as Section[]).map(
          (s) => html`<button aria-pressed=${this.section === s} @click=${() => (this.section = s)}>${tr(`maintenance.nav.${s}`)}</button>`,
        )}
      </div>
      ${this.section === 'tasks'
        ? this.#renderTasks()
        : this.section === 'chains'
          ? html`<tessera-maint-chains
              .api=${this.api}
              .runtime=${rt}
              @edit-task=${(e: CustomEvent<{ id: string }>) => this.#editor?.edit(e.detail.id)}
              @create-task=${() => this.#editor?.create()}
            ></tessera-maint-chains>`
          : this.section === 'journal'
            ? this.#renderJournal()
            : this.#renderSettings()}
      <tessera-maint-editor .api=${this.api} .runtime=${rt}></tessera-maint-editor>
    `;
  }
}
