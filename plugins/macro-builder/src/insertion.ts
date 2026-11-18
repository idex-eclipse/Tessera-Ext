import type * as Blockly from 'blockly/core';

/** Insert a statement without detaching the rest of the existing chain. */
export function connectStatement(connection: Blockly.Connection, block: Blockly.Block): void {
  const following = connection.targetConnection;
  if (following) connection.disconnect();
  connection.connect(block.previousConnection!);
  if (following) block.nextConnection?.connect(following);
}

/** A newly added control block takes the next shortcut block into its body. */
export function insertionConnection(anchor: Blockly.Block, enterBody: boolean): Blockly.Connection | null {
  if (enterBody && (anchor.type === 'mb_if' || anchor.type === 'mb_for')) {
    return anchor.getInput('DO')?.connection ?? null;
  }
  return anchor.nextConnection;
}
