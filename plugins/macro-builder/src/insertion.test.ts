import * as Blockly from 'blockly/core';
import { describe, expect, it } from 'vitest';
import { connectStatement, insertionConnection } from './insertion';

// Headless Blockly connections verify the serialized tree shape without SVG rendering.
Blockly.defineBlocksWithJsonArray([
  { type: 'mb_test_statement', message0: 'statement', previousStatement: null, nextStatement: null },
  { type: 'mb_if', message0: 'if %1', args0: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null, nextStatement: null },
  { type: 'mb_for', message0: 'for %1', args0: [{ type: 'input_statement', name: 'DO' }],
    previousStatement: null, nextStatement: null },
]);

describe('shortcut block insertion', () => {
  it.each(['mb_if', 'mb_for'])('enters a newly inserted %s body and retains its existing first child', (type) => {
    const workspace = new Blockly.Workspace();
    try {
      const control = workspace.newBlock(type);
      const oldChild = workspace.newBlock('mb_test_statement');
      control.getInput('DO')!.connection!.connect(oldChild.previousConnection!);
      const inserted = workspace.newBlock('mb_test_statement');
      connectStatement(insertionConnection(control, true)!, inserted);
      expect(control.getInputTargetBlock('DO')).toBe(inserted);
      expect(inserted.getNextBlock()).toBe(oldChild);
    } finally {
      workspace.dispose();
    }
  });

  it('inserts after the last statement without losing the following chain', () => {
    const workspace = new Blockly.Workspace();
    try {
      const before = workspace.newBlock('mb_test_statement');
      const after = workspace.newBlock('mb_test_statement');
      before.nextConnection!.connect(after.previousConnection!);
      const inserted = workspace.newBlock('mb_if');
      connectStatement(insertionConnection(before, false)!, inserted);
      expect(before.getNextBlock()).toBe(inserted);
      expect(inserted.getNextBlock()).toBe(after);
      const inner = workspace.newBlock('mb_test_statement');
      connectStatement(insertionConnection(inserted, true)!, inner);
      expect(inserted.getInputTargetBlock('DO')).toBe(inner);
      expect(inserted.getNextBlock()).toBe(after);
    } finally {
      workspace.dispose();
    }
  });
});
