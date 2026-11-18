// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MacroBuilderDialog } from './ui';

// The test exercises caret movement without loading Blockly's SVG workspace.
customElements.define('macro-builder-test-dialog', MacroBuilderDialog);

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('macro builder command suggestions', () => {
  it('opens Config suggestions when the caret moves after an equals sign without typing', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const dialog = document.createElement('macro-builder-test-dialog') as MacroBuilderDialog;
    const panel = document.createElement('div');
    const field = document.createElement('input');
    field.className = 'blocklyHtmlInput';
    field.value = 'SET_GCODE_VARIABLE MACRO=';
    field.setSelectionRange(field.value.length, field.value.length);
    document.body.append(dialog, panel, field);

    const suggest = vi.fn(() => [{ label: 'PARK', insert: 'PARK', kind: 'macro', from: field.value.length }]);
    Reflect.set(dialog, 'session', { suggest });
    Reflect.set(dialog, 'suggestionPanel', panel);
    const onPointerUp = Reflect.get(dialog, 'onFieldPointerUp') as EventListener;
    document.addEventListener('pointerup', onPointerUp, true);
    try {
      field.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      expect(suggest).toHaveBeenCalledWith(field.value, field.value.length, [], '');
      expect(panel.hidden).toBe(false);
      expect(panel.querySelector('.mb-suggestion')?.textContent).toBe('PARK');
    } finally {
      document.removeEventListener('pointerup', onPointerUp, true);
    }
  });
});

describe('macro builder insertion keys', () => {
  it('maps the four editor keys and leaves text fields and modified keys alone', () => {
    const dialog = document.createElement('macro-builder-test-dialog') as MacroBuilderDialog;
    document.body.append(dialog);
    const modal = dialog.querySelector('dialog')!;
    modal.setAttribute('open', '');
    const canvas = document.createElement('div');
    const input = document.createElement('input');
    modal.append(canvas, input);
    const insertBlock = vi.fn();
    Reflect.set(dialog, 'builder', { insertBlock, dispose: vi.fn() });
    const press = (target: Element, code: string, options: KeyboardEventInit = {}): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...options });
      target.dispatchEvent(event);
      return event;
    };

    expect(press(canvas, 'KeyC').defaultPrevented).toBe(true);
    press(canvas, 'KeyM');
    press(canvas, 'KeyC', { altKey: true });
    press(canvas, 'KeyL');
    expect(insertBlock.mock.calls.map(([kind]) => kind)).toEqual(['command', 'call', 'if', 'for']);
    expect(press(input, 'KeyC').defaultPrevented).toBe(false);
    expect(press(canvas, 'KeyC', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(press(canvas, 'KeyC', { repeat: true }).defaultPrevented).toBe(false);
    expect(insertBlock).toHaveBeenCalledTimes(4);
    expect(modal.dataset.hotkeyEditorOwner).toBe('tessera/macro-builder');
    // jsdom does not implement dialog.close(), so end its simulated open state.
    modal.removeAttribute('open');
  });
});
