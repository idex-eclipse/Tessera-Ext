/** Each line retains its exact terminator for lossless round trips. */
interface SourceLine { text: string; from: number; to: number; }

/** A visual statement with its original source span. */
export interface MacroNode {
  kind: 'command' | 'call' | 'assign' | 'comment' | 'raw' | 'if' | 'for' | 'set_macro_var' | 'save_var';
  value: string;
  source: string;
  from: number;
  to: number;
  header: string;
  footer: string;
  children: MacroNode[];
  elseHeader: string;
  elseChildren: MacroNode[];
  keyword: 'if' | 'elif';
}

/** A macro option remains linked to its original line for exact preservation. */
export interface MacroVariable { name: string; value: string; source: string; from: number; }

/** Keep existing Klipper comments intact while making new block text a G-code comment. */
export function commentBody(value: string): string {
  return /^[#;]/.test(value.trimStart()) ? value : `# ${value}`;
}

/** The existing section envelope and its parsed gcode body. */
export interface MacroDocument {
  name: string;
  prefix: string;
  suffix: string;
  indent: string;
  eol: string;
  nodes: MacroNode[];
  variables: MacroVariable[];
  source: string;
  existing: boolean;
}

function linesOf(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  for (const match of source.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    if (match[0]) lines.push({ text: match[0], from: match.index, to: match.index + match[0].length });
  }
  return lines;
}

function tag(line: string): { word: string; value: string } | null {
  const match = /^\s*\{%-?\s*(if|elif|else|endif|for|endfor)\b(.*?)\s*-?%\}\s*(?:\r?\n|\r)?$/i.exec(line);
  return match ? { word: (match[1] ?? '').toLowerCase(), value: (match[2] ?? '').trim() } : null;
}

function node(kind: MacroNode['kind'], value: string, source: string, from: number, to: number): MacroNode {
  return { kind, value, source, from, to, header: source, footer: '', children: [],
    elseHeader: '', elseChildren: [], keyword: 'if' };
}

/** Treat a Jinja expression as one editable raw span even when it crosses lines. */
function jinjaEnd(lines: SourceLine[], start: number): number {
  const opening = lines[start]?.text.indexOf('{') ?? -1;
  if (opening < 0) return start;
  for (let index = start; index < lines.length; index++) {
    if ((lines[index]?.text.indexOf('}', index === start ? opening + 1 : 0) ?? -1) >= 0) return index;
  }
  return start;
}

/** Balanced controls become nested nodes; ambiguous Jinja remains raw. */
function parseBody(source: string, base: number, macroNames: ReadonlySet<string>): MacroNode[] {
  const lines = linesOf(source);
  let at = 0;
  const read = (stop: ReadonlySet<string>): MacroNode[] => {
    const out: MacroNode[] = [];
    while (at < lines.length) {
      const current = lines[at]!;
      const control = tag(current.text);
      if (control && stop.has(control.word)) break;
      if (control?.word === 'if' || control?.word === 'for') {
        const first = lines[at++]!;
        const group = node(control.word, control.value, '', base + first.from, base + first.to);
        group.header = first.text;
        group.children = read(new Set(control.word === 'if' ? ['elif', 'else', 'endif'] : ['endfor']));
        if (control.word === 'if') {
          let branch = group;
          while (tag(lines[at]?.text ?? '')?.word === 'elif') {
            const line = lines[at++]!;
            const elif = node('if', tag(line.text)!.value, '', base + line.from, base + line.to);
            elif.keyword = 'elif';
            elif.header = line.text;
            elif.children = read(new Set(['elif', 'else', 'endif']));
            branch.elseChildren = [elif];
            branch = elif;
          }
          if (tag(lines[at]?.text ?? '')?.word === 'else') {
            branch.elseHeader = lines[at++]!.text;
            branch.elseChildren = read(new Set(['endif']));
          }
        }
        const expected = control.word === 'if' ? 'endif' : 'endfor';
        if (tag(lines[at]?.text ?? '')?.word !== expected) throw new Error('Unbalanced Jinja');
        group.footer = lines[at++]!.text;
        group.to = base + lines[at - 1]!.to;
        group.source = source.slice(first.from, lines[at - 1]!.to);
        out.push(group);
        continue;
      }
      if (control) throw new Error('Ambiguous Jinja');
      const rawEnd = /^\s*[#;]/.test(current.text) ? at : jinjaEnd(lines, at);
      if (rawEnd > at) {
        const end = lines[rawEnd]!;
        const span = source.slice(current.from, end.to);
        out.push(node('raw', span.replace(/(?:\r\n|\n|\r)$/, ''), span, base + current.from, base + end.to));
        at = rawEnd + 1;
        continue;
      }
      at++;
      const line = current.text;
      const trimmed = line.trim();
      const command = /^\s*([A-Za-z_][A-Za-z_0-9]*)\b(.*?)(?:\r?\n|\r)?$/.exec(line);
      const assign = /^\s*\{%[-]?\s*set\s+(.+?)\s*[-]?%\}\s*(?:\r?\n|\r)?$/.exec(line);
      let kind: MacroNode['kind'] = 'raw';
      let value = trimmed;
      if (assign) { kind = 'assign'; value = assign[1] ?? ''; }
      else if (trimmed.startsWith('#') || trimmed.startsWith(';')) { kind = 'comment'; value = trimmed; }
      else if (command) {
        // Inline Jinja is still an argument of the command; only an ambiguous
        // multiline brace span needs a raw block to keep its exact source.
        const verb = (command[1] ?? '').toUpperCase();
        kind = verb === 'SET_GCODE_VARIABLE' ? 'set_macro_var'
          : verb === 'SAVE_VARIABLE' ? 'save_var'
            : macroNames.has(verb) ? 'call' : 'command';
        value = `${command[1] ?? ''}${command[2] ?? ''}`.trimEnd();
      }
      out.push(node(kind, value, line, base + current.from, base + current.to));
    }
    return out;
  };
  try {
    const nodes = read(new Set());
    if (at !== lines.length) throw new Error('Unmatched Jinja');
    return nodes;
  } catch {
    // An unbalanced control cannot be edited structurally, but its brace span stays intact.
    const raw: MacroNode[] = [];
    for (let index = 0; index < lines.length;) {
      const first = lines[index]!;
      const endIndex = jinjaEnd(lines, index);
      const last = lines[endIndex]!;
      const span = source.slice(first.from, last.to);
      raw.push(node('raw', span.replace(/(?:\r\n|\n|\r)$/, ''), span,
        base + first.from, base + last.to));
      index = endIndex + 1;
    }
    return raw;
  }
}

/** Parse a section, preserving all options outside its gcode body. */
export function parseMacro(source: string | null, names: readonly string[]): MacroDocument {
  if (source === null) return { name: '', prefix: '', suffix: '', indent: '    ', eol: '\n', nodes: [], variables: [], source: '', existing: false };
  const lines = linesOf(source);
  const header = /^\s*\[\s*gcode_macro\s+([^\]\s]+)\s*\]/i.exec(lines[0]?.text ?? '');
  const gcode = lines.findIndex((line, index) => index > 0 && /^\s*gcode\s*[:=]\s*(?:[#;].*)?(?:\r?\n|\r)?$/i.test(line.text));
  if (!header || gcode < 0) return { name: header?.[1] ?? '', prefix: source, suffix: '', indent: '    ',
    eol: source.includes('\r\n') ? '\r\n' : '\n', nodes: [], variables: [], source, existing: true };
  const bodyStart = lines[gcode]!.to;
  const endIndex = lines.findIndex((line, index) => index > gcode && /^[A-Za-z_][\w]*\s*[:=]/.test(line.text));
  const bodyEnd = endIndex < 0 ? source.length : lines[endIndex]!.from;
  const body = source.slice(bodyStart, bodyEnd);
  const firstIndented = linesOf(body).find((line) => /^\s+\S/.test(line.text));
  const indent = /^([ \t]+)/.exec(firstIndented?.text ?? '')?.[1] ?? '    ';
  const variables = lines.slice(1, gcode).flatMap((line) => {
    const match = /^\s*variable_([a-z_][a-z0-9_]*)\s*[:=]\s*(.*?)(?:\r\n|\n|\r)?$/.exec(line.text);
    return match ? [{ name: match[1] ?? '', value: match[2] ?? '', source: line.text, from: line.from }] : [];
  });
  return {
    name: header[1] ?? '', prefix: source.slice(0, bodyStart), suffix: source.slice(bodyEnd), indent,
    eol: source.includes('\r\n') ? '\r\n' : '\n',
    variables,
    nodes: parseBody(body, bodyStart, new Set(names.map((name) => name.toUpperCase()))), source, existing: true,
  };
}

/** Rewrite only variable option lines; all other macro options retain their bytes. */
export function renderHeader(document: MacroDocument, name: string, variables: readonly MacroVariable[]): string {
  if (!document.existing) {
    const options = variables.map((item) => `variable_${item.name}: ${item.value}${document.eol}`).join('');
    return `[gcode_macro ${name}]${document.eol}${options}gcode:${document.eol}`;
  }
  const byFrom = new Map(variables.filter((item) => item.from >= 0).map((item) => [item.from, item]));
  const fresh = variables.filter((item) => item.from < 0)
    .map((item) => `variable_${item.name}: ${item.value}${document.eol}`).join('');
  let header = '';
  for (const line of linesOf(document.prefix)) {
    if (/^\s*gcode\s*[:=]/i.test(line.text)) header += fresh;
    const original = document.variables.find((item) => item.from === line.from);
    const edited = byFrom.get(line.from);
    if (!original) header += line.text;
    else if (edited) header += edited.name === original.name && edited.value === original.value
      ? original.source : `variable_${edited.name}: ${edited.value}${document.eol}`;
  }
  return header.replace(/^(\s*\[\s*gcode_macro\s+)[^\]\s]+/i, `$1${name}`);
}

/** Klipper reserves lowercase names for macro options and persistent variables. */
export function validVariableName(name: string): boolean { return /^[a-z_][a-z0-9_]*$/.test(name); }

/** Macro names are case-insensitive in Klipper's command namespace. */
export function validMacroName(name: string, known: readonly string[], original = ''): boolean {
  return /^[A-Za-z_][A-Za-z_0-9]*$/.test(name) &&
    (name.toUpperCase() === original.toUpperCase() || !known.some((item) => item.toUpperCase() === name.toUpperCase()));
}
