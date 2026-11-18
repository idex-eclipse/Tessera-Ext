# Macro Builder

Optional Blockly editor for Klipper `[gcode_macro ...]` sections in Tessera Config.
Install `tessera/macro-builder` after updating Tessera to a build with
`@core/config` 4.1.0 or later. The Config editor shows a builder button in writable
`.cfg` files. Blockly is downloaded only when the dialog is opened. The builder
fills the viewport and follows Tessera's light, dark, and high-contrast colors,
including changes while it is open.

Place the cursor in a macro to edit it. Elsewhere, enter a unique name to create a
macro at the end of the current file. The toolbox offers commands, macro calls,
assignments, comments, conditions, loops, and raw Jinja or text. Expressions stay
textual. Long fields expand, and a Jinja span from `{` through its next `}` stays
in one multiline raw block. Local `variable_*` options can be edited beside the
macro name; dedicated blocks emit `SET_GCODE_VARIABLE` and `SAVE_VARIABLE`.
New comment blocks start with `#`. The variable command blocks show compact
previews in the toolbox and receive editable command templates when placed on the
canvas. Opening a command field leaves the caret at the end instead of selecting
all text; moving it directly after `=` shows Config's suggestions without typing.
Commands with inline Jinja expressions stay command blocks, including both
variable commands. The macro and variable fields offer names from Config;
`VALUE=` offers a Python literal template labelled with the known default or
stored value type. New saved-variable names can be entered directly.
While typing in a block, Config supplies its existing contextual command and
Jinja suggestions. Every matching option remains available in a scrollable list.
On a narrow screen, **Blocks** opens the collapsed toolbox. Selected blocks
can also be moved or deleted with buttons.

With focus in the builder outside a text field, press `C` to add a command,
`M` to add a macro call, `Alt+C` to add a condition, or `L` to add a loop.
The new block follows the selected or last edited block. After adding a condition
or loop, the next shortcut inserts into its body. These canvas keys use physical
key positions, including under a Russian keyboard layout; they do not interrupt
typing in command, name, or variable fields.

**Apply to editor** changes only Config's unsaved buffer. Config still handles
Ctrl+Z, Save, `.bak`, and Save & Restart. **Cancel** leaves the buffer untouched.
If the source changes while the builder is open, close it and open it again.

The parser keeps source spans for every statement. Unchanged statements, comments,
blank lines, and unknown Jinja keep their original text. Edited recognized blocks
use the current macro's indentation. Raw text remains editable.

For development, run `npm install`, `npm run typecheck`, `npm test`, and
`npm run pack`. `npm run pack` writes the built archive and hash into `registry/`.
The production bundle has a small entry module and a separate lazy Blockly chunk.
