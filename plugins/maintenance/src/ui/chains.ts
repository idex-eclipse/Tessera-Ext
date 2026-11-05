import { css, html, nothing, svg, type PropertyValues, type TemplateResult } from 'lit';

import { TesseraElement } from '../base-element';
import {
  autoLayout,
  boardSize,
  chainTasks,
  edgeKey,
  edgePath,
  edgesOf,
  NODE_W,
  type Edge,
  type Point,
} from '../core/chains';
import { applySnapshot, ChainHistory, type ChainSnapshot } from '../core/chain-history';
import { validateGraph } from '../core/graph';
import type { MaintenanceRuntime } from '../core/runtime';
import { outcomeLabel, taskName } from './format';
import { styles } from './styles';

/** A drag shorter than this is a click, not a move. */
const DRAG_SLOP_PX = 4;

interface NodeDrag {
  id: string;
  startX: number;
  startY: number;
  orig: Point;
  moved: boolean;
}

interface LinkDrag {
  from: string;
  outcome: string;
}

/**
 * <tessera-maint-chains> - the visual chain editor.
 *
 * Every task is a card on a board; every result button of a card has an output dot. Dragging
 * from a dot onto another card makes that result trigger the card ("Belts: Adjusted" ->
 * "Shaper calibration"). A line is selected by clicking it and removed with the button or the
 * Delete key. Cards are moved by their title; the positions are saved with the state.
 *
 * Right-to-left: card positions are offsets from the START edge (`inset-inline-start`), the
 * lines are measured from the real dot positions and bend towards the end of the line, so the
 * whole picture mirrors. Pointer events are used instead of HTML drag and drop, which does
 * not exist on touch screens.
 *
 * Narrow screens: the board needs room, so it is hidden below ~700px of width and the
 * "Links" list under it (also the keyboard-friendly way to edit) takes over.
 */
export class MaintChains extends TesseraElement {
  static override styles = [
    styles,
    css`
      .scroller {
        overflow: auto;
        max-block-size: min(70vh, 720px);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        background: var(--bg-surface-hover-no-override);
      }
      .board {
        position: relative;
        min-inline-size: 100%;
      }
      /* Only the two drawing layers of the board: a bare "svg" rule would also stretch the
         small icons inside the buttons over the whole tab. */
      .board > svg {
        position: absolute;
        inset: 0;
        inline-size: 100%;
        block-size: 100%;
        overflow: visible;
        pointer-events: none;
      }
      .board > svg.top {
        z-index: 2;
      }
      path.line {
        fill: none;
        stroke: var(--accent);
        stroke-width: 2;
        opacity: 0.75;
      }
      path.line.selected {
        stroke-width: 4;
        opacity: 1;
      }
      path.hit {
        fill: none;
        stroke: transparent;
        stroke-width: 16;
        pointer-events: stroke;
        cursor: pointer;
      }
      path.ghost {
        fill: none;
        stroke: var(--accent);
        stroke-width: 2;
        stroke-dasharray: 6 4;
      }
      .node {
        position: absolute;
        z-index: 1;
        background: var(--bg-surface);
        border: 1px solid var(--border-color);
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow-sm);
      }
      .node.soon {
        border-color: var(--warning);
      }
      .node.overdue {
        border-color: var(--danger);
      }
      .node.off {
        opacity: 0.6;
      }
      .node.target {
        outline: 2px solid var(--accent);
      }
      .node-head {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--space-xs);
        padding: var(--space-xs) var(--space-sm);
        min-block-size: 44px;
        border-block-end: 1px solid var(--border-color);
        cursor: grab;
        touch-action: none;
        user-select: none;
      }
      .node-head.dragging {
        cursor: grabbing;
      }
      .node-title {
        flex: 1;
        min-width: 0;
        font-weight: 600;
        font-size: var(--font-size-sm);
        overflow-wrap: anywhere;
      }
      .row-out {
        position: relative;
        display: flex;
        align-items: center;
        min-block-size: 34px;
        padding-inline: var(--space-sm) var(--space-md);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        overflow-wrap: anywhere;
      }
      .port {
        position: absolute;
        inline-size: 14px;
        block-size: 14px;
        box-sizing: border-box;
        border-radius: 50%;
        border: 2px solid var(--accent);
        background: var(--bg-surface);
        touch-action: none;
      }
      .port.in {
        inset-inline-start: -8px;
        inset-block-start: 50%;
        transform: translateY(-50%);
      }
      .port.out {
        inset-inline-end: -8px;
        inset-block-start: 50%;
        transform: translateY(-50%);
        cursor: crosshair;
      }
      .port.out.linked {
        background: var(--accent);
      }
      .port.out:hover,
      .port.out:focus-visible {
        outline: 3px solid var(--border-focus);
      }
      /* The board needs room: narrow widths get the list editor only. */
      .wide-only {
        display: block;
      }
      .narrow-only {
        display: none;
      }
      @container (max-width: 700px) {
        .wide-only {
          display: none;
        }
        .narrow-only {
          display: block;
        }
      }
      table {
        inline-size: 100%;
        border-collapse: collapse;
        font-size: var(--font-size-sm);
      }
      td {
        padding: var(--space-xs) var(--space-sm);
        border-block-end: 1px solid var(--border-color);
        overflow-wrap: anywhere;
        vertical-align: middle;
      }
      td.act {
        inline-size: 1%;
        white-space: nowrap;
      }
      .arrow {
        color: var(--text-muted);
      }
      .form {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
        gap: var(--space-sm);
        align-items: end;
      }
    `,
  ];

  static override properties = {
    ...TesseraElement.properties,
    runtime: { attribute: false },
    selected: { state: true },
    formFrom: { state: true },
    formOutcome: { state: true },
    formTo: { state: true },
    formError: { state: true },
  };

  declare runtime: MaintenanceRuntime | null;
  /** Key of the selected line (see edgeKey). */
  declare selected: string;
  declare formFrom: string;
  declare formOutcome: string;
  declare formTo: string;
  declare formError: string;

  /** Positions while a card is being dragged, before they are saved. */
  #live = new Map<string, Point>();
  #drag: NodeDrag | null = null;
  #link: LinkDrag | null = null;
  #hover = '';

  constructor() {
    super();
    this.runtime = null;
    this.selected = '';
    this.formFrom = '';
    this.formOutcome = '';
    this.formTo = '';
    this.formError = '';
  }

  #unsub: (() => void) | null = null;
  /** Undo / redo of the links and the card positions, for as long as this editor is open. */
  #history = new ChainHistory();

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener('keydown', this.#onKey);
    window.addEventListener('keydown', this.#onHistoryKey);
    this.#bind();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('keydown', this.#onKey);
    window.removeEventListener('keydown', this.#onHistoryKey);
    this.#unsub?.();
    this.#unsub = null;
  }

  override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (changed.has('runtime')) this.#bind();
  }

  /** The runtime object stays the same while its state changes, so listen to it. */
  #bind(): void {
    this.#unsub?.();
    this.#history.reset(this.runtime?.state ?? null);
    this.#unsub =
      this.runtime && this.isConnected
        ? this.runtime.subscribe(() => {
            // Every change of the links or the positions becomes one undo step; an undo or
            // redo itself arrives here too, but equals the current snapshot, so it is not recorded.
            const state = this.runtime?.state;
            if (state) this.#history.changed(state);
            this.requestUpdate();
          })
        : null;
  }

  #restore(snap: ChainSnapshot | null): void {
    if (!snap) return;
    this.selected = '';
    this.runtime?.mutate((s) => applySnapshot(s, snap));
  }

  /** The host's undo / redo icons (components/icons/Icon.svelte); mirrored in right-to-left. */
  #icon(name: 'undo' | 'redo'): TemplateResult {
    return svg`<svg class=${this.#dir === -1 ? 'flip' : ''} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      ${name === 'undo'
        ? svg`<path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"></path>`
        : svg`<path d="m15 14 5-5-5-5"></path><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"></path>`}
    </svg>`;
  }

  #undo(): void {
    this.#restore(this.#history.undo());
    this.requestUpdate();
  }

  #redo(): void {
    this.#restore(this.#history.redo());
    this.requestUpdate();
  }

  /**
   * Ctrl+Z undoes, Ctrl+Y (or Ctrl+Shift+Z) redoes; Cmd works the same on a Mac. Like the
   * dashboard editor it is a window-wide shortcut while the editor is open, so the user does
   * not have to click the board first. It stays out of the way of text fields (their own undo)
   * and of the task editor dialog.
   */
  #onHistoryKey = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    // The physical key, not the typed character: on a Russian layout Ctrl+Z types "я", so
    // matching `e.key` would never fire there. The host's hotkeys do the same (core/hotkeys.ts).
    const key = /^Key([A-Z])$/.exec(e.code ?? '')?.[1]?.toLowerCase() ?? e.key.toLowerCase();
    const redo = key === 'y' || (key === 'z' && e.shiftKey);
    const undo = key === 'z' && !e.shiftKey;
    if (!undo && !redo) return;
    const path = e.composedPath();
    const target = path[0] as Element | undefined;
    if (target?.matches?.('input, select, textarea, [contenteditable]')) return;
    if (path.some((n) => n instanceof HTMLElement && (n.tagName === 'DIALOG' || n.tagName === 'TESSERA-MAINT-EDITOR'))) return;
    e.preventDefault();
    if (undo) this.#undo();
    else this.#redo();
  };

  // ----- geometry -------------------------------------------------------------

  get #dir(): 1 | -1 {
    return getComputedStyle(this).direction === 'rtl' ? -1 : 1;
  }

  #positions(): Record<string, Point> {
    const state = this.runtime?.state;
    if (!state) return {};
    const auto = autoLayout(state);
    const out: Record<string, Point> = {};
    for (const t of chainTasks(state)) out[t.id] = this.#live.get(t.id) ?? state.layout?.[t.id] ?? auto[t.id] ?? { x: 0, y: 0 };
    return out;
  }

  #board(): HTMLElement | null {
    return this.renderRoot.querySelector('.board');
  }

  /** Centre of an element in board coordinates (works in either text direction). */
  #center(el: Element, board: DOMRect): Point {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2 - board.left, y: r.top + r.height / 2 - board.top };
  }

  /** Re-measures the dots and redraws every line. Called after each render and while dragging. */
  #redraw(): void {
    const board = this.#board();
    const state = this.runtime?.state;
    if (!board || !state) return;
    const br = board.getBoundingClientRect();
    const ports = new Map<string, Element>();
    for (const p of this.renderRoot.querySelectorAll('[data-port]')) ports.set((p as HTMLElement).dataset.port!, p);
    const dir = this.#dir;
    for (const el of this.renderRoot.querySelectorAll<SVGPathElement>('path[data-edge]')) {
      const [from, outcome, to] = el.dataset.edge!.split('|');
      const a = ports.get(`out:${from}:${outcome}`);
      const b = ports.get(`in:${to}`);
      if (a && b) el.setAttribute('d', edgePath(this.#center(a, br), this.#center(b, br), dir));
    }
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    this.#redraw();
  }

  // ----- moving cards ---------------------------------------------------------

  #headDown(e: PointerEvent, id: string): void {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    const head = e.currentTarget as HTMLElement;
    head.setPointerCapture(e.pointerId);
    head.classList.add('dragging');
    this.#drag = { id, startX: e.clientX, startY: e.clientY, orig: this.#positions()[id] ?? { x: 0, y: 0 }, moved: false };
  }

  #headMove(e: PointerEvent): void {
    const d = this.#drag;
    if (!d) return;
    const dx = (e.clientX - d.startX) * this.#dir;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
    d.moved = true;
    const p = { x: Math.max(0, d.orig.x + dx), y: Math.max(0, d.orig.y + dy) };
    this.#live.set(d.id, p);
    // Moved directly in the DOM: a full render on every pointer move would be too heavy.
    const node = this.renderRoot.querySelector<HTMLElement>(`.node[data-id="${CSS.escape(d.id)}"]`);
    if (node) {
      node.style.insetInlineStart = `${p.x}px`;
      node.style.insetBlockStart = `${p.y}px`;
    }
    this.#redraw();
  }

  #headUp(e: PointerEvent): void {
    const d = this.#drag;
    this.#drag = null;
    (e.currentTarget as HTMLElement).classList.remove('dragging');
    if (!d?.moved || !this.runtime) {
      this.#live.clear();
      return;
    }
    // The first move fixes the whole arrangement: later link edits must not shuffle the cards.
    this.runtime.setLayout({ ...this.#positions() });
    this.#live.clear();
  }

  // ----- linking --------------------------------------------------------------

  #ghost(): SVGPathElement | null {
    return this.renderRoot.querySelector('path.ghost');
  }

  #portDown(e: PointerEvent, from: string, outcome: string): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.#link = { from, outcome };
  }

  #portMove(e: PointerEvent): void {
    if (!this.#link) return;
    const board = this.#board();
    if (!board) return;
    const br = board.getBoundingClientRect();
    const start = this.#center(e.currentTarget as Element, br);
    this.#ghost()?.setAttribute('d', edgePath(start, { x: e.clientX - br.left, y: e.clientY - br.top }, this.#dir));
    const under = (this.renderRoot as ShadowRoot).elementFromPoint(e.clientX, e.clientY)?.closest('.node') as HTMLElement | null;
    const id = under?.dataset.id ?? '';
    if (id !== this.#hover) {
      this.renderRoot.querySelector('.node.target')?.classList.remove('target');
      if (under) under.classList.add('target');
      this.#hover = id;
    }
  }

  #portUp(): void {
    const l = this.#link;
    const to = this.#hover;
    this.#link = null;
    this.#hover = '';
    this.renderRoot.querySelector('.node.target')?.classList.remove('target');
    this.#ghost()?.setAttribute('d', '');
    if (l && to && this.runtime) this.runtime.linkOutcome(l.from, l.outcome, to);
  }

  // ----- selection and the list editor ----------------------------------------

  #onKey = (e: KeyboardEvent): void => {
    if ((e.key !== 'Delete' && e.key !== 'Backspace') || !this.selected) return;
    if ((e.composedPath()[0] as Element | undefined)?.matches?.('input, select, textarea')) return;
    this.#removeSelected();
  };

  #edgeByKey(key: string): Edge | undefined {
    const state = this.runtime?.state;
    return state ? edgesOf(state).find((e) => edgeKey(e) === key) : undefined;
  }

  #removeSelected(): void {
    const edge = this.#edgeByKey(this.selected);
    this.selected = '';
    if (edge) this.runtime?.unlinkOutcome(edge);
  }

  #addFromForm(): void {
    if (!this.runtime || !this.formFrom || !this.formOutcome || !this.formTo) return;
    const err = this.runtime.linkOutcome(this.formFrom, this.formOutcome, this.formTo);
    this.formError = err === 'duplicate' ? this.t('maintenance.chains.duplicate') : '';
  }

  #dispatch(name: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  // ----- rendering ------------------------------------------------------------

  #renderNode(taskId: string, p: Point): TemplateResult {
    const rt = this.runtime!;
    const tr = (k: string, o?: Record<string, string | number>): string => this.t(k, o);
    const task = rt.state!.tasks.find((t) => t.id === taskId)!;
    const status = rt.evals.find((e) => e.taskId === taskId)?.status ?? 'off';
    return html`<div
      class="node ${status}"
      data-id=${task.id}
      style="inset-inline-start:${p.x}px;inset-block-start:${p.y}px;inline-size:${NODE_W}px"
    >
      <div
        class="node-head"
        @pointerdown=${(e: PointerEvent) => this.#headDown(e, task.id)}
        @pointermove=${(e: PointerEvent) => this.#headMove(e)}
        @pointerup=${(e: PointerEvent) => this.#headUp(e)}
        @pointercancel=${(e: PointerEvent) => this.#headUp(e)}
        @dblclick=${() => this.#dispatch('edit-task', { id: task.id })}
      >
        <span class="port in" data-port=${`in:${task.id}`}></span>
        <span class="node-title">${taskName(tr, task)}${task.tool ? html` <span class="muted ltr">(${task.tool})</span>` : nothing}</span>
        <button class="small icon" title=${tr('maintenance.common.edit')} aria-label=${tr('maintenance.common.edit')} @click=${() => this.#dispatch('edit-task', { id: task.id })}>…</button>
      </div>
      ${task.outcomes.map(
        (o) => html`<div class="row-out">
          <span>${outcomeLabel(tr, o)}</span>
          <span
            class="port out ${o.activates.length > 0 ? 'linked' : ''}"
            data-port=${`out:${task.id}:${o.id}`}
            role="button"
            aria-label=${tr('maintenance.chains.dragHint', { name: outcomeLabel(tr, o) })}
            title=${tr('maintenance.chains.dragHint', { name: outcomeLabel(tr, o) })}
            @pointerdown=${(e: PointerEvent) => this.#portDown(e, task.id, o.id)}
            @pointermove=${(e: PointerEvent) => this.#portMove(e)}
            @pointerup=${() => this.#portUp()}
            @pointercancel=${() => this.#portUp()}
          ></span>
        </div>`,
      )}
    </div>`;
  }

  #renderLinks(edges: Edge[]): TemplateResult {
    const rt = this.runtime!;
    const state = rt.state!;
    const tr = (k: string, o?: Record<string, string | number>): string => this.t(k, o);
    const tasks = chainTasks(state);
    const name = (id: string): string => {
      const t = state.tasks.find((x) => x.id === id);
      return t ? `${taskName(tr, t)}${t.tool ? ` (${t.tool})` : ''}` : id;
    };
    const outcomes = state.tasks.find((t) => t.id === this.formFrom)?.outcomes ?? [];
    const canAdd = !!(this.formFrom && this.formOutcome && this.formTo);

    return html`<section class="panel">
      <div class="panel-header"><span class="panel-title">${tr('maintenance.chains.links')}</span></div>
      <div class="panel-body">
        ${edges.length === 0
          ? html`<p class="muted">${tr('maintenance.chains.noLinks')}</p>`
          : html`<table>
              <tbody>
                ${edges.map((e) => {
                  const task = state.tasks.find((t) => t.id === e.from);
                  const o = task?.outcomes.find((x) => x.id === e.outcome);
                  return html`<tr>
                    <td>${name(e.from)}: <strong>${o ? outcomeLabel(tr, o) : e.outcome}</strong></td>
                    <td class="arrow" aria-hidden="true">→</td>
                    <td>${name(e.to)}</td>
                    <td class="act"><button class="small danger" @click=${() => rt.unlinkOutcome(e)}>${tr('maintenance.chains.remove')}</button></td>
                  </tr>`;
                })}
              </tbody>
            </table>`}
        <span class="field-label">${tr('maintenance.chains.addLink')}</span>
        <div class="form">
          <label class="field">
            <span class="field-label">${tr('maintenance.chains.from')}</span>
            <select
              @change=${(e: Event) => {
                this.formFrom = (e.target as HTMLSelectElement).value;
                this.formOutcome = state.tasks.find((t) => t.id === this.formFrom)?.outcomes[0]?.id ?? '';
              }}
            >
              <option value="" ?selected=${!this.formFrom}></option>
              ${tasks.map((t) => html`<option value=${t.id} ?selected=${this.formFrom === t.id}>${name(t.id)}</option>`)}
            </select>
          </label>
          <label class="field">
            <span class="field-label">${tr('maintenance.chains.outcome')}</span>
            <select @change=${(e: Event) => (this.formOutcome = (e.target as HTMLSelectElement).value)}>
              ${outcomes.map((o) => html`<option value=${o.id} ?selected=${this.formOutcome === o.id}>${outcomeLabel(tr, o)}</option>`)}
            </select>
          </label>
          <label class="field">
            <span class="field-label">${tr('maintenance.chains.to')}</span>
            <select @change=${(e: Event) => (this.formTo = (e.target as HTMLSelectElement).value)}>
              <option value="" ?selected=${!this.formTo}></option>
              ${tasks.map((t) => html`<option value=${t.id} ?selected=${this.formTo === t.id}>${name(t.id)}</option>`)}
            </select>
          </label>
          <button class="primary" ?disabled=${!canAdd} @click=${() => this.#addFromForm()}>${tr('maintenance.chains.add')}</button>
        </div>
        ${this.formError ? html`<p class="warn">${this.formError}</p>` : nothing}
      </div>
    </section>`;
  }

  override render(): TemplateResult {
    const rt = this.runtime;
    const state = rt?.state;
    if (!rt || !state) return html``;
    const tr = (k: string, o?: Record<string, string | number>): string => this.t(k, o);
    const tasks = chainTasks(state);
    const pos = this.#positions();
    const edges = edgesOf(state);
    const size = boardSize(tasks, pos);
    const cycle = validateGraph(state).some((i) => i.code === 'cycle');
    const hasSelected = !!this.selected && !!this.#edgeByKey(this.selected);

    return html`
      <section class="panel">
        <div class="panel-header">
          <span class="panel-title">${tr('maintenance.chains.title')}</span>
          <span class="panel-meta">
            <button class="icon-btn" ?disabled=${!this.#history.canUndo} title=${tr('maintenance.chains.undoHint')} aria-label=${tr('maintenance.chains.undo')} @click=${() => this.#undo()}>${this.#icon('undo')}</button>
            <button class="icon-btn" ?disabled=${!this.#history.canRedo} title=${tr('maintenance.chains.redoHint')} aria-label=${tr('maintenance.chains.redo')} @click=${() => this.#redo()}>${this.#icon('redo')}</button>
            ${hasSelected ? html`<button class="danger" @click=${() => this.#removeSelected()}>${tr('maintenance.chains.removeSelected')}</button>` : nothing}
            <button class="wide-only" ?disabled=${!state.layout} @click=${() => rt.setLayout(null)}>${tr('maintenance.chains.arrange')}</button>
            <button class="primary" @click=${() => this.#dispatch('create-task')}>${tr('maintenance.common.add')}</button>
          </span>
        </div>
        <div class="panel-body">
          <p class="muted wide-only">${tr('maintenance.chains.hint')}</p>
          <p class="muted narrow-only">${tr('maintenance.chains.hintNarrow')}</p>
          ${cycle ? html`<p class="warn">${tr('maintenance.editor.cycle')}</p>` : nothing}
          <div class="scroller wide-only">
            <div class="board" style="inline-size:${size.w}px;block-size:${size.h}px" @click=${(e: Event) => {
              if (!(e.target as Element).closest('path.hit')) this.selected = '';
            }}>
              <svg aria-hidden="true">
                <defs>
                  <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
                  </marker>
                </defs>
                ${edges.map((e) => {
                  const key = edgeKey(e);
                  return svg`<path class="line ${this.selected === key ? 'selected' : ''}" data-edge=${key} marker-end="url(#arrow)" d=""></path>
                    <path class="hit" data-edge=${key} d="" @click=${(ev: Event) => {
                      ev.stopPropagation();
                      this.selected = key;
                    }}></path>`;
                })}
              </svg>
              ${tasks.map((t) => this.#renderNode(t.id, pos[t.id] ?? { x: 0, y: 0 }))}
              <svg class="top" aria-hidden="true"><path class="ghost" d=""></path></svg>
            </div>
          </div>
        </div>
      </section>
      ${this.#renderLinks(edges)}
    `;
  }
}
