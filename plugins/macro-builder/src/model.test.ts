import { describe, expect, it } from 'vitest';
import { commentBody, parseMacro, renderHeader, validMacroName, validVariableName } from './model';

describe('macro source model', () => {
  it('prefixes newly entered comment text while retaining explicit comment markers', () => {
    expect(commentBody('park the toolhead')).toBe('# park the toolhead');
    expect(commentBody('# existing')).toBe('# existing');
    expect(commentBody('; existing')).toBe('; existing');
  });

  it('recognizes nested if, elif, else and for while retaining source spans', () => {
    const source = '[gcode_macro PARK]\r\ngcode:\r\n    {% if printer.toolhead.homed_axes == "xyz" %}\r\n' +
      '        {% for axis in ["x", "y"] %}\r\n            G0 X1\r\n        {% endfor %}\r\n' +
      '    {% elif params.FORCE|default(0)|int %}\r\n        M118 Forced\r\n' +
      '    {% else %}\r\n        # leave unchanged\r\n    {% endif %}\r\n';
    const parsed = parseMacro(source, ['PARK']);
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.nodes[0]).toMatchObject({ kind: 'if', source: source.slice(parsed.prefix.length) });
    expect(parsed.nodes[0]?.children[0]?.kind).toBe('for');
    expect(parsed.nodes[0]?.elseChildren[0]?.keyword).toBe('elif');
    expect(parsed.eol).toBe('\r\n');
  });

  it('keeps unknown Jinja, comments and blank lines byte exact', () => {
    const source = '[gcode_macro M]\ngcode:\n    {action_respond_info("x")}\n\n    # note\n';
    const parsed = parseMacro(source, ['M']);
    expect(parsed.prefix + parsed.nodes.map((node) => node.source).join('') + parsed.suffix).toBe(source);
    expect(parsed.nodes.map((node) => node.kind)).toEqual(['raw', 'raw', 'comment']);
  });

  it('requires a unique case-insensitive name', () => {
    expect(validMacroName('PARK_2', ['park'])).toBe(true);
    expect(validMacroName('Park', ['PARK'])).toBe(false);
    expect(validMacroName('park', ['PARK'], 'PARK')).toBe(true);
    expect(validMacroName('bad name', [])).toBe(false);
  });

  it('keeps a multiline Jinja expression in one editable raw node', () => {
    const source = '[gcode_macro M]\ngcode:\n    M118 { action_respond_info(\n      "hello"\n    ) }\n    G28\n';
    const parsed = parseMacro(source, ['M']);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0]).toMatchObject({ kind: 'raw', source: '    M118 { action_respond_info(\n      "hello"\n    ) }\n' });
    expect(parsed.nodes[1]?.kind).toBe('command');
  });

  it('preserves unchanged variable options and edits only the chosen option', () => {
    const source = '[gcode_macro M]\r\ndescription: sample\r\nvariable_count = 1\r\nvariable_state: "idle"\r\ngcode:\r\n    M118 ok\r\n';
    const parsed = parseMacro(source, ['M']);
    expect(parsed.variables.map((item) => item.name)).toEqual(['count', 'state']);
    expect(renderHeader(parsed, 'M', parsed.variables)).toBe(parsed.prefix);
    const edited = parsed.variables.map((item) => item.name === 'count' ? { ...item, value: '2' } : item);
    expect(renderHeader(parsed, 'M', edited)).toContain('variable_count: 2\r\nvariable_state: "idle"\r\n');
    expect(renderHeader(parsed, 'M', [...edited, { name: 'new_value', value: 'True', source: '', from: -1 }]))
      .toContain('variable_new_value: True\r\ngcode:');
    expect(validVariableName('count_2')).toBe(true);
    expect(validVariableName('Count')).toBe(false);
  });

  it('recognizes the two variable write commands as distinct blocks', () => {
    const source = '[gcode_macro M]\ngcode:\n    SET_GCODE_VARIABLE MACRO=M VARIABLE=count VALUE=2\n' +
      '    SAVE_VARIABLE VARIABLE=mode VALUE="ready"\n';
    expect(parseMacro(source, ['M']).nodes.map((item) => item.kind)).toEqual(['set_macro_var', 'save_var']);
  });

  it('keeps inline Jinja expressions inside their command blocks', () => {
    const source = '[gcode_macro MOVE]\ngcode:\n    G1 X{var_x}\n' +
      '    SAVE_VARIABLE VARIABLE=is_print VALUE={is_print}\n' +
      '    SET_GCODE_VARIABLE MACRO=MOVE VARIABLE=x VALUE={var_x + 1}\n';
    const parsed = parseMacro(source, ['MOVE']);
    expect(parsed.nodes.map((item) => item.kind)).toEqual(['command', 'save_var', 'set_macro_var']);
    expect(parsed.prefix + parsed.nodes.map((item) => item.source).join('') + parsed.suffix).toBe(source);
  });
});
