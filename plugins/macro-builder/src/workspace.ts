import * as Blockly from 'blockly/core';
import * as English from 'blockly/msg/en';
import * as Russian from 'blockly/msg/ru';
import { FieldMultilineInput } from '@blockly/field-multilineinput';
import { connectStatement, insertionConnection } from './insertion';
import { commentBody, renderHeader, type MacroDocument, type MacroNode, type MacroVariable } from './model';

/** Data for the narrow handoff from the host's completion catalog. */
export interface BuilderHints { macroNames: string[]; commands: Array<{ name: string; params: string[] }>; objects: string[]; }

interface Origin { node: MacroNode; value: string; previous: string | null; surround: string | null; doIds: string[]; elseIds: string[]; }

const kinds = ['command', 'call', 'assign', 'comment', 'raw', 'if', 'for', 'set_macro_var', 'save_var'] as const;

/** Toolbox previews stay short; new workspace blocks receive their editable commands. */
const NEW_BLOCK_VALUES: Readonly<Record<string, string>> = {
  mb_set_macro_var: 'SET_GCODE_VARIABLE MACRO= VARIABLE= VALUE=',
  mb_save_var: 'SAVE_VARIABLE VARIABLE= VALUE=',
};

/** Blockly paints SVG surfaces itself, so it needs resolved host tokens at each theme change. */
function blocklyTheme(): Blockly.Theme {
  const root = getComputedStyle(globalThis.document.documentElement);
  const token = (name: string): string => root.getPropertyValue(name).trim();
  return Blockly.Theme.defineTheme('tessera-macro-builder', {
    name: 'tessera-macro-builder',
    base: Blockly.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: token('--bg-app'),
      toolboxBackgroundColour: token('--bg-surface'),
      toolboxForegroundColour: token('--text-primary'),
      flyoutBackgroundColour: token('--bg-surface-hover-no-override'),
      flyoutForegroundColour: token('--text-primary'),
      scrollbarColour: token('--border-color'),
      insertionMarkerColour: token('--accent'),
      markerColour: token('--accent'),
      cursorColour: token('--accent'),
      selectedGlowColour: token('--accent'),
    },
  });
}

/** Blockly's default display limit clips longer G-code before the user opens its editor. */
class ExpandingText extends Blockly.FieldTextInput {
  constructor(value = '') { super(value); this.maxDisplayLength = 10000; }
  protected override showEditor_(event?: Event, quietInput?: boolean): void {
    super.showEditor_(event, quietInput);
    const input = this.htmlInput_;
    // Blockly selects the whole command on open; put the caret at its end for editing.
    if (input && !quietInput) requestAnimationFrame(() => {
      if (this.htmlInput_ === input && document.activeElement === input) {
        input.setSelectionRange(input.value.length, input.value.length);
        input.dispatchEvent(new Event('macro-builder-caret', { bubbles: true }));
      }
    });
  }
  static override fromJson(options: Parameters<typeof Blockly.FieldTextInput.fromJson>[0]): ExpandingText {
    return new ExpandingText(options.text ?? '');
  }
}

/** The official multiline field renders each Jinja line inside one Blockly block. */
class ExpandingMultiline extends FieldMultilineInput {
  constructor(value = '') { super(value); this.maxDisplayLength = 10000; }
  override showEditor_(event?: Event, quietInput?: boolean): void {
    super.showEditor_(event, quietInput);
    const input = this.htmlInput_;
    if (input && !quietInput) requestAnimationFrame(() => {
      if (this.htmlInput_ === input && document.activeElement === input) {
        input.setSelectionRange(input.value.length, input.value.length);
        input.dispatchEvent(new Event('macro-builder-caret', { bubbles: true }));
      }
    });
  }
  static override fromJson(options: Parameters<typeof FieldMultilineInput.fromJson>[0]): ExpandingMultiline {
    return new ExpandingMultiline(options.text ?? '');
  }
}

Blockly.fieldRegistry.register('mb_expanding_text', ExpandingText);
Blockly.fieldRegistry.register('mb_expanding_multiline', ExpandingMultiline);
FieldMultilineInput.enterCommits = false;

/** Register a small domain toolbox without importing Blockly into Tessera itself. */
function registerBlocks(labels: Record<string, string>): void {
  for (const kind of kinds) {
    const type = `mb_${kind}`;
    if (Blockly.Blocks[type]) continue;
    const message = `${labels[kind] ?? kind} %1`;
    const definition: Record<string, unknown> = {
      type, message0: message, args0: [{
        type: kind === 'raw' ? 'mb_expanding_multiline' : 'mb_expanding_text', name: 'VALUE',
        text: kind === 'comment' ? '# ' : '',
      }],
      previousStatement: null, nextStatement: null,
      colour: kind === 'raw' ? 0 : kind === 'if' || kind === 'for' ? 275
        : kind === 'call' ? 330 : kind === 'set_macro_var' || kind === 'save_var' ? 45 : 205,
      tooltip: labels[kind] ?? kind,
    };
    if (kind === 'if') {
      definition.message1 = `${labels.then ?? 'then'} %1`;
      definition.args1 = [{ type: 'input_statement', name: 'DO' }];
      definition.message2 = `${labels.else ?? 'else'} %1`;
      definition.args2 = [{ type: 'input_statement', name: 'ELSE' }];
    } else if (kind === 'for') {
      definition.message1 = `${labels.do ?? 'do'} %1`;
      definition.args1 = [{ type: 'input_statement', name: 'DO' }];
    }
    Blockly.defineBlocksWithJsonArray([definition]);
  }
}

function chain(start: Blockly.Block | null): Blockly.Block[] {
  const blocks: Blockly.Block[] = [];
  for (let block = start; block; block = block.getNextBlock()) blocks.push(block);
  return blocks;
}

/** Owns Blockly's workspace and preserves source for blocks the user has not changed. */
export class MacroWorkspace {
  readonly workspace: Blockly.WorkspaceSvg;
  private readonly toolbox = { kind: 'flyoutToolbox' as const,
    contents: kinds.map((kind) => ({ kind: 'block' as const, type: `mb_${kind}` })) };
  private readonly origins = new Map<string, Origin>();
  private readonly document: MacroDocument;
  private lastEditedBlockId: string | null = null;
  private enterBodyBlockId: string | null = null;

  constructor(mount: HTMLElement, document: MacroDocument, hints: BuilderHints, labels: Record<string, string>, rtl: boolean) {
    this.document = document;
    // Blockly requires a locale before inject; the host's translations cover our own chrome.
    const messages = globalThis.document.documentElement.getAttribute('data-locale')?.startsWith('ru') ? Russian : English;
    // The package exposes CJS locale data under `default` in Vite's ESM wrapper.
    Blockly.setLocale((messages as unknown as { default?: Record<string, string> }).default ??
      (messages as unknown as Record<string, string>));
    registerBlocks(labels);
    this.workspace = Blockly.inject(mount, {
      theme: blocklyTheme(),
      rtl, trashcan: true, scrollbars: true, move: { drag: true, wheel: true },
      zoom: { controls: true, pinch: true, wheel: true, startScale: 0.85, minScale: 0.35, maxScale: 2 },
      toolbox: this.toolbox,
    });
    // Creation events run only in the main workspace, keeping flyout blocks compact.
    this.workspace.addChangeListener((event) => {
      if (event.type === Blockly.Events.BLOCK_CREATE) {
        for (const id of (event as Blockly.Events.BlockCreate).ids ?? []) {
          const block = this.workspace.getBlockById(id);
          if (!block) continue;
          const initial = NEW_BLOCK_VALUES[block.type];
          if (initial && block.getFieldValue('VALUE') === '') block.setFieldValue(initial, 'VALUE');
          this.lastEditedBlockId = id;
          this.enterBodyBlockId = block.type === 'mb_if' || block.type === 'mb_for' ? id : null;
        }
      } else if (event.type === Blockly.Events.BLOCK_CHANGE ||
        (event.type === Blockly.Events.BLOCK_MOVE &&
          (event as Blockly.Events.BlockMove).reason?.includes('drag'))) {
        const id = (event as Blockly.Events.BlockChange | Blockly.Events.BlockMove).blockId;
        if (id && this.workspace.getBlockById(id)) {
          this.lastEditedBlockId = id;
          if (this.enterBodyBlockId !== id) this.enterBodyBlockId = null;
        }
      }
    });
    // Blockly places its text editor outside the canvas; scope its host-token styles to this dialog.
    Blockly.WidgetDiv.getDiv()?.classList.add('macro-builder-widget');
    const load = (nodes: MacroNode[], connection: Blockly.Connection | null): void => {
      let previous: Blockly.BlockSvg | null = null;
      for (const item of nodes) {
        const block = this.workspace.newBlock(`mb_${item.kind}`);
        block.setFieldValue(item.value, 'VALUE');
        block.initSvg();
        block.render();
        if (previous) previous.nextConnection?.connect(block.previousConnection!);
        else if (connection) connection.connect(block.previousConnection!);
        // Blockly maps workspace coordinates for RTL; a positive inset keeps the first block clickable.
        else block.moveBy(60, 40 + this.workspace.getTopBlocks(false).length * 45);
        if (item.children.length) load(item.children, block.getInput('DO')?.connection ?? null);
        if (item.elseChildren.length) load(item.elseChildren, block.getInput('ELSE')?.connection ?? null);
        previous = block;
        this.origins.set(block.id, { node: item, value: item.value, previous: block.getPreviousBlock()?.id ?? null,
          surround: block.getSurroundParent()?.id ?? null,
          doIds: chain(block.getInputTargetBlock('DO')).map((child) => child.id),
          elseIds: chain(block.getInputTargetBlock('ELSE')).map((child) => child.id) });
      }
    };
    Blockly.Events.disable();
    try { load(document.nodes, null); }
    finally { Blockly.Events.enable(); }
    // Every existing block starts with its final tree position after all connections exist.
    for (const [id, origin] of this.origins) {
      const block = this.workspace.getBlockById(id);
      if (block) {
        origin.previous = block.getPreviousBlock()?.id ?? null;
        origin.surround = block.getSurroundParent()?.id ?? null;
        origin.doIds = chain(block.getInputTargetBlock('DO')).map((child) => child.id);
        origin.elseIds = chain(block.getInputTargetBlock('ELSE')).map((child) => child.id);
      }
    }
    // Hints stay local to the dialog and are available in the HTML datalist.
    void hints;
  }

  /** Redraw Blockly's own SVG surfaces after Tessera changes theme or contrast. */
  updateTheme(): void { this.workspace.setTheme(blocklyTheme()); }

  /** Return the selected block for touch-friendly move and delete buttons. */
  selected(): Blockly.BlockSvg | null {
    const selected = Blockly.getSelected();
    return selected instanceof Blockly.BlockSvg && selected.workspace === this.workspace ? selected : null;
  }

  /** Insert after the selected or last edited statement, entering a new control block first. */
  insertBlock(kind: 'command' | 'call' | 'if' | 'for'): Blockly.BlockSvg {
    const selected = this.selected();
    const remembered = this.lastEditedBlockId && this.workspace.getBlockById(this.lastEditedBlockId);
    const top = this.workspace.getTopBlocks(true).at(-1) ?? null;
    const anchor = selected ?? remembered ?? (top && chain(top).at(-1)) ?? null;
    const block = this.workspace.newBlock(`mb_${kind}`);
    block.initSvg();
    block.render();
    if (anchor) {
      const connection = insertionConnection(anchor, anchor.id === this.enterBodyBlockId);
      if (connection) connectStatement(connection, block);
    } else {
      // Blockly maps workspace coordinates for RTL; keep a fresh statement in the visible inset.
      block.moveBy(60, 40);
    }
    block.select();
    this.lastEditedBlockId = block.id;
    this.enterBodyBlockId = kind === 'if' || kind === 'for' ? block.id : null;
    return block;
  }

  /** A raw block uses a textarea because Blockly's single-line field cannot edit multiline Jinja. */
  editSelectedRaw(text: string): void {
    const block = this.selected();
    if (block?.type === 'mb_raw') block.setFieldValue(text, 'VALUE');
  }

  /** An empty flyout releases its reserved width without replacing the workspace. */
  setToolboxVisible(visible: boolean): void {
    this.workspace.updateToolbox(visible ? this.toolbox : { kind: 'flyoutToolbox', contents: [] });
    Blockly.svgResize(this.workspace);
  }

  /** Generate only the body; Config supplies the protected section range. */
  serialize(name: string, variables: readonly MacroVariable[]): string {
    const body = this.workspace.getTopBlocks(true).flatMap((block) => chain(block)).map((block) => this.emit(block, 0)).join('');
    return renderHeader(this.document, name, variables) + body + this.document.suffix;
  }

  private unchanged(block: Blockly.Block, origin: Origin): boolean {
    const ids = (input: string) => chain(block.getInputTargetBlock(input)).map((child) => child.id);
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, index) => id === b[index]);
    return block.getFieldValue('VALUE') === origin.value &&
      block.getPreviousBlock()?.id === origin.previous && block.getSurroundParent()?.id === origin.surround &&
      same(ids('DO'), origin.doIds) && same(ids('ELSE'), origin.elseIds) &&
      [...chain(block.getInputTargetBlock('DO')), ...chain(block.getInputTargetBlock('ELSE'))]
        .every((child) => { const childOrigin = this.origins.get(child.id); return !!childOrigin && this.unchanged(child, childOrigin); });
  }

  private emit(block: Blockly.Block, depth: number): string {
    const origin = this.origins.get(block.id);
    const raw = origin?.node.kind === 'raw' || block.type === 'mb_raw';
    if (origin && this.unchanged(block, origin) && origin.node.source) return origin.node.source;
    const eol = this.document.eol;
    const indent = this.document.indent + '    '.repeat(depth);
    const value = String(block.getFieldValue('VALUE') ?? '');
    if (raw) return origin && value === origin.value ? origin.node.source : `${value}${value.endsWith(eol) ? '' : eol}`;
    const kind = block.type.slice(3);
    if (kind === 'if' || kind === 'for') {
      const keyword = kind === 'if' && origin?.node.keyword === 'elif' ? 'elif' : kind;
      const children = chain(block.getInputTargetBlock('DO')).map((child) => this.emit(child, depth + 1)).join('');
      const otherBlocks = chain(block.getInputTargetBlock('ELSE'));
      const elif = otherBlocks.length === 1 && this.origins.get(otherBlocks[0]!.id)?.node.keyword === 'elif';
      const otherwise = otherBlocks.map((child) => this.emit(child, elif ? depth : depth + 1)).join('');
      const elseHeader = otherwise && !elif && (origin?.node.elseHeader || `${indent}{% else %}${eol}`);
      const footer = keyword === 'elif' ? '' : `${indent}{% end${kind} %}${eol}`;
      return `${indent}{% ${keyword} ${value} %}${eol}${children}${elseHeader || ''}${otherwise}${footer}`;
    }
    if (kind === 'assign') return `${indent}{% set ${value} %}${eol}`;
    if (kind === 'comment') return `${indent}${commentBody(value)}${eol}`;
    return `${indent}${value}${eol}`;
  }

  /** Release SVG listeners and DOM once the dialog closes. */
  dispose(): void {
    Blockly.WidgetDiv.getDiv()?.classList.remove('macro-builder-widget');
    this.workspace.dispose();
  }
}
