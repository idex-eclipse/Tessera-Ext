import { css, html, nothing, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import { defaultAnswers } from '../core/presets';
import type { MaintenanceRuntime } from '../core/runtime';
import type { FeederType, NozzleType, RailType, WashHabit, WizardAnswers } from '../core/types';
import { styles } from './styles';

const RAILS: RailType[] = ['ball-liquid', 'ball-grease', 'carbon', 'none'];
const AXES = ['x', 'y', 'z'] as const;

/**
 * <tessera-maint-wizard> - the first-run screen.
 *
 * One scrollable form instead of a stepper: it is shorter to use on a phone and every
 * question is visible together with its explanation. The answers become intervals through
 * core/presets.ts; nothing is applied until "Apply" (or "Skip" for the defaults).
 *
 * Fires `wizard-done` when the user applied, skipped or cancelled.
 */
export class MaintWizard extends TesseraElement {
  static override styles = [
    styles,
    css`
      fieldset {
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        margin: 0;
        padding: var(--space-sm) var(--space-md);
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-xs);
      }
      legend {
        font-weight: 600;
        padding-inline: var(--space-xs);
      }
      label {
        display: flex;
        align-items: center;
        gap: var(--space-sm);
        min-block-size: 32px;
        overflow-wrap: anywhere;
      }
      input[type='number'] {
        inline-size: 6em;
      }
      .axis {
        display: grid;
        grid-template-columns: max-content 1fr;
        gap: var(--space-sm);
        align-items: center;
      }
      @container (max-width: 520px) {
        .axis {
          grid-template-columns: 1fr;
        }
      }
    `,
  ];

  static override properties = {
    ...TesseraElement.properties,
    runtime: { attribute: false },
    answers: { state: true },
    rerun: { type: Boolean },
  };

  declare runtime: MaintenanceRuntime | null;
  declare answers: WizardAnswers | null;
  /** Opened again from the settings: "Cancel" instead of "Skip". */
  declare rerun: boolean;

  constructor() {
    super();
    this.runtime = null;
    this.answers = null;
    this.rerun = false;
  }

  override willUpdate(changed: Map<string, unknown>): void {
    super.willUpdate(changed as never);
    if (!this.answers && this.runtime?.state) {
      // Start from the previous answers (a repeated run), else from the defaults.
      const tools = this.#tools();
      this.answers = structuredClone(this.runtime.state.onboarding.answers ?? defaultAnswers(tools));
      for (const t of tools) {
        this.answers.nozzle[t] ??= { type: 'brass' };
        this.answers.feeder[t] ??= { type: 'regular' };
      }
    }
  }

  #tools(): string[] {
    const fromState = this.runtime?.state?.tasks.flatMap((t) => (t.defId === 'nozzle' && t.tool ? [t.tool] : [])) ?? [];
    return fromState.length > 0 ? fromState : ['extruder'];
  }

  #done(): void {
    this.dispatchEvent(new CustomEvent('wizard-done', { bubbles: true, composed: true }));
  }

  #set(fn: (a: WizardAnswers) => void): void {
    if (!this.answers) return;
    const next = structuredClone(this.answers);
    fn(next);
    this.answers = next;
  }

  #radio(name: string, value: string, checked: boolean, label: string, onPick: () => void): TemplateResult {
    return html`<label><input type="radio" name=${name} .checked=${checked} @change=${onPick} />${label}</label>`;
  }

  override render(): TemplateResult {
    const a = this.answers;
    if (!a || !this.runtime) return html``;
    const tr = (k: string, p?: Record<string, string | number>): string => this.t(k, p);
    const tools = this.#tools();

    return html`
      <section class="panel">
        <div class="panel-header"><span class="panel-title">${tr('maintenance.wizard.title')}</span></div>
        <div class="panel-body">
          <p class="muted">${tr('maintenance.wizard.intro')}</p>

          <fieldset>
            <legend>${tr('maintenance.wizard.bedCheck.title')}</legend>
            <p class="muted">${tr('maintenance.wizard.bedCheck.text')}</p>
            ${this.#radio('bed', 'on', a.bedCheck, tr('maintenance.wizard.bedCheck.on'), () => this.#set((x) => (x.bedCheck = true)))}
            ${this.#radio('bed', 'off', !a.bedCheck, tr('maintenance.wizard.bedCheck.off'), () => this.#set((x) => (x.bedCheck = false)))}
          </fieldset>

          <fieldset>
            <legend>${tr('maintenance.wizard.wash.title')}</legend>
            <p class="muted">${tr('maintenance.task.bed-wash.why')}</p>
            ${(['glue-stick', 'normal', 'custom'] as WashHabit[]).map((h) =>
              this.#radio(
                'wash',
                h,
                a.wash.habit === h,
                h === 'glue-stick' ? tr('maintenance.wizard.wash.glue') : h === 'normal' ? tr('maintenance.wizard.wash.normal') : tr('maintenance.wizard.wash.custom'),
                () => this.#set((x) => (x.wash.habit = h)),
              ),
            )}
            ${a.wash.habit === 'custom'
              ? html`<input
                  type="number"
                  min="1"
                  .value=${String(a.wash.days ?? 7)}
                  @input=${(e: Event) => this.#set((x) => (x.wash.days = Number((e.target as HTMLInputElement).value) || 7))}
                />`
              : nothing}
          </fieldset>

          <fieldset>
            <legend>${tr('maintenance.wizard.rails.title')}</legend>
            <p class="muted">${tr('maintenance.wizard.rails.text')}</p>
            <p class="muted">${tr('maintenance.task.lube-axes.why')}</p>
            ${AXES.map(
              (axis) => html`
                <div class="axis">
                  <span>${tr(`maintenance.wizard.axis.${axis}`)}</span>
                  <select
                    .value=${a.rails[axis]}
                    @change=${(e: Event) => this.#set((x) => (x.rails[axis] = (e.target as HTMLSelectElement).value as RailType))}
                  >
                    ${RAILS.map((r) => html`<option value=${r} ?selected=${a.rails[axis] === r}>${tr(`maintenance.rail.${r}`)}</option>`)}
                  </select>
                </div>
              `,
            )}
          </fieldset>

          <fieldset>
            <legend>${tr('maintenance.wizard.belts.title')}</legend>
            <p class="muted">${tr('maintenance.task.belts.why')}</p>
            ${this.#radio('belts', 'on', a.belts, tr('maintenance.wizard.belts.on'), () => this.#set((x) => (x.belts = true)))}
            ${this.#radio('belts', 'off', !a.belts, tr('maintenance.wizard.belts.off'), () => this.#set((x) => (x.belts = false)))}
          </fieldset>

          ${tools.map(
            (tool) => html`
              <fieldset>
                <legend>${tr('maintenance.wizard.nozzle.title')} <span class="chip ltr">${tool}</span></legend>
                <p class="muted">${tr('maintenance.task.nozzle.why')}</p>
                ${(['brass', 'hardened', 'custom'] as NozzleType[]).map((n) =>
                  this.#radio(`nozzle-${tool}`, n, a.nozzle[tool]?.type === n, tr(`maintenance.wizard.nozzle.${n}`), () =>
                    this.#set((x) => (x.nozzle[tool] = { type: n, km: x.nozzle[tool]?.km })),
                  ),
                )}
                ${a.nozzle[tool]?.type === 'custom'
                  ? html`<input
                      type="number"
                      min="0.1"
                      step="0.1"
                      .value=${String(a.nozzle[tool]?.km ?? 10)}
                      @input=${(e: Event) => this.#set((x) => (x.nozzle[tool] = { type: 'custom', km: Number((e.target as HTMLInputElement).value) || 10 }))}
                    />`
                  : nothing}
              </fieldset>
              <fieldset>
                <legend>${tr('maintenance.wizard.feeder.title')} <span class="chip ltr">${tool}</span></legend>
                <p class="warn">${tr('maintenance.wizard.feeder.warning')}</p>
                ${(['regular', 'planetary'] as FeederType[]).map((f) =>
                  this.#radio(`feeder-${tool}`, f, a.feeder[tool]?.type === f, tr(`maintenance.wizard.feeder.${f}`), () =>
                    this.#set((x) => (x.feeder[tool] = { type: f })),
                  ),
                )}
              </fieldset>
            `,
          )}

          <fieldset>
            <legend>${tr('maintenance.wizard.custom.title')}</legend>
            <p class="muted">${tr('maintenance.wizard.custom.text')}</p>
          </fieldset>

          <div class="row">
            <button
              class="primary"
              @click=${() => {
                this.runtime?.finishWizard(a);
                this.#done();
              }}
            >
              ${tr('maintenance.wizard.finish')}
            </button>
            <button
              @click=${() => {
                if (!this.rerun) this.runtime?.skipWizard();
                this.#done();
              }}
            >
              ${this.rerun ? tr('maintenance.wizard.cancel') : tr('maintenance.wizard.skip')}
            </button>
          </div>
        </div>
      </section>
    `;
  }
}
