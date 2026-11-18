/** All visible labels use the plugin's own locale namespace. */
export default { macroBuilder: {
  title: 'Visual macro builder', newMacro: 'New macro', name: 'Macro name',
  apply: 'Apply to editor', cancel: 'Cancel', loading: 'Loading blocks…',
  stale: 'The Config buffer changed. Close the builder and open it again.',
  closeReopen: 'Close and reopen', invalidName: 'Use a unique macro name with letters, digits, and underscores.',
  blocks: 'Blocks', delete: 'Delete block', moveUp: 'Move up', moveDown: 'Move down',
  rawEdit: 'Edit raw text', rawSave: 'Keep raw text', rawCancel: 'Cancel raw edit',
  command: 'Command', call: 'Macro call', assign: 'Set variable', comment: 'Comment',
  setMacroVar: 'Set macro variable', saveVar: 'Save global variable',
  variables: 'Local macro variables', variableName: 'Variable name', initialValue: 'Initial value',
  addVariable: 'Add variable', removeVariable: 'Remove variable',
  invalidVariable: 'Use unique lowercase variable names and nonempty initial values.',
  raw: 'Raw Jinja / text', if: 'If / elif', for: 'For loop', then: 'Then', else: 'Else', do: 'Do',
  suggestions: 'Commands, macros, parameters and Klipper objects',
  loadError: 'Could not load the visual editor.',
} };
