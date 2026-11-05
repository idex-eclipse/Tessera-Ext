/**
 * The pure side of the chain editor: which edges exist, how to lay the cards out and how to
 * add or remove a link. No DOM here, so the same functions serve the canvas, the list
 * editor for narrow screens and the tests.
 *
 * A chain is the graph that core/graph.ts already validates: an edge goes from an OUTCOME
 * of one task (a button on its card) to the task it makes due.
 */
import type { MaintenanceState, Task } from './types';

export interface Edge {
  from: string;
  outcome: string;
  to: string;
}

export interface Point {
  x: number;
  y: number;
}

/** Ids never contain a pipe, so it can join the three parts of a link into one attribute value. */
export const edgeKey = (e: Edge): string => `${e.from}|${e.outcome}|${e.to}`;

/** Cards shown in the editor: the bed check has no outcomes, so it cannot be part of a chain. */
export function chainTasks(state: Pick<MaintenanceState, 'tasks'>): Task[] {
  return state.tasks.filter((t) => t.kind !== 'precheck');
}

/** Every link, in a stable order (card order, then button order). Links to unknown tasks are dropped. */
export function edgesOf(state: Pick<MaintenanceState, 'tasks'>): Edge[] {
  const ids = new Set(chainTasks(state).map((t) => t.id));
  const out: Edge[] = [];
  for (const t of chainTasks(state)) {
    for (const o of t.outcomes) {
      for (const to of o.activates) if (ids.has(to)) out.push({ from: t.id, outcome: o.id, to });
    }
  }
  return out;
}

/** Layout constants shared with the canvas element. */
export const NODE_W = 232;
export const GAP_X = 96;
export const GAP_Y = 24;
const HEAD_H = 52;
const ROW_H = 34;
const PAD = 16;

/** Rough height of a card, to stack cards without measuring the DOM. */
export function nodeHeight(task: Task): number {
  return HEAD_H + Math.max(1, task.outcomes.length) * ROW_H + PAD;
}

/**
 * Default layout: columns by distance from the cards nobody triggers, so a chain reads from
 * its start to its end. Cycles do not matter here: a card already on the current path is not
 * followed again.
 */
export function autoLayout(state: Pick<MaintenanceState, 'tasks'>): Record<string, Point> {
  const tasks = chainTasks(state);
  const edges = edgesOf(state);
  const incoming = new Map<string, number>();
  const next = new Map<string, string[]>();
  for (const t of tasks) {
    incoming.set(t.id, 0);
    next.set(t.id, []);
  }
  for (const e of edges) {
    if (e.from === e.to) continue;
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    next.get(e.from)?.push(e.to);
  }

  const level = new Map<string, number>();
  const walk = (id: string, depth: number, path: Set<string>): void => {
    if (path.has(id)) return;
    if ((level.get(id) ?? -1) >= depth) return;
    level.set(id, depth);
    path.add(id);
    for (const to of next.get(id) ?? []) walk(to, depth + 1, path);
    path.delete(id);
  };
  for (const t of tasks) if ((incoming.get(t.id) ?? 0) === 0) walk(t.id, 0, new Set());
  // Cards that only sit in a cycle have no root: start them at the left as well.
  for (const t of tasks) if (!level.has(t.id)) walk(t.id, 0, new Set());

  const columns = new Map<number, Task[]>();
  for (const t of tasks) {
    const l = level.get(t.id) ?? 0;
    columns.set(l, [...(columns.get(l) ?? []), t]);
  }
  const pos: Record<string, Point> = {};
  for (const [l, col] of columns) {
    let y = GAP_Y;
    // Linked cards first, loose ones below, so chains stay together at the top.
    const sorted = [...col].sort((a, b) => Number(isLoose(a, edges)) - Number(isLoose(b, edges)));
    for (const t of sorted) {
      pos[t.id] = { x: GAP_X / 2 + l * (NODE_W + GAP_X), y };
      y += nodeHeight(t) + GAP_Y;
    }
  }
  return pos;
}

function isLoose(task: Task, edges: Edge[]): boolean {
  return !edges.some((e) => e.from === task.id || e.to === task.id);
}

/** Size of the board that holds all the cards, with room to drag further. */
export function boardSize(tasks: Task[], pos: Record<string, Point>): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const t of tasks) {
    const p = pos[t.id];
    if (!p) continue;
    w = Math.max(w, p.x + NODE_W);
    h = Math.max(h, p.y + nodeHeight(t));
  }
  return { w: w + GAP_X, h: h + GAP_Y * 2 };
}

export type LinkError = 'unknown-task' | 'unknown-outcome' | 'bad-target' | 'duplicate';

/** True if the task takes part in chains (it has outcomes the user can link). */
function linkable(t: Task | undefined): t is Task {
  return !!t && t.kind !== 'precheck';
}

/**
 * Adds a link "outcome of `from` makes `to` due". A task may be linked to itself (a
 * "repeat"); the same link twice is refused. Returns the new state or the reason.
 */
export function addLink(
  state: MaintenanceState,
  from: string,
  outcome: string,
  to: string,
): { state: MaintenanceState } | { error: LinkError } {
  const src = state.tasks.find((t) => t.id === from);
  const dst = state.tasks.find((t) => t.id === to);
  if (!linkable(src)) return { error: 'unknown-task' };
  if (!linkable(dst)) return { error: 'bad-target' };
  const o = src.outcomes.find((x) => x.id === outcome);
  if (!o) return { error: 'unknown-outcome' };
  if (o.activates.includes(to)) return { error: 'duplicate' };
  return {
    state: {
      ...state,
      tasks: state.tasks.map((t) =>
        t.id === from ? { ...t, outcomes: t.outcomes.map((x) => (x.id === outcome ? { ...x, activates: [...x.activates, to] } : x)) } : t,
      ),
    },
  };
}

/** Removes a link. Returns the same state when there was no such link. */
export function removeLink(state: MaintenanceState, e: Edge): MaintenanceState {
  const src = state.tasks.find((t) => t.id === e.from);
  if (!src?.outcomes.some((o) => o.id === e.outcome && o.activates.includes(e.to))) return state;
  return {
    ...state,
    tasks: state.tasks.map((t) =>
      t.id === e.from
        ? { ...t, outcomes: t.outcomes.map((o) => (o.id === e.outcome ? { ...o, activates: o.activates.filter((a) => a !== e.to) } : o)) }
        : t,
    ),
  };
}

/**
 * SVG path of a link between two points. The curve leaves the output port towards the end
 * of the line and enters the input port from its start, so `dir` (1 for left-to-right text,
 * -1 for right-to-left) mirrors the whole drawing for RTL.
 */
export function edgePath(a: Point, b: Point, dir: 1 | -1): string {
  const k = Math.max(48, Math.abs(b.x - a.x) / 2);
  const c1 = { x: a.x + dir * k, y: a.y };
  const c2 = { x: b.x - dir * k, y: b.y };
  return `M ${a.x} ${a.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${b.x} ${b.y}`;
}
