import { css } from 'lit';

/**
 * Styles of the tab, adopted into its shadow root (Lit `static styles`).
 *
 * Only the host's design tokens are used (--bg-surface, --accent, --space-*, …,
 * docs/en/i18n-and-theming.md). They are CSS custom properties, which inherit
 * into the shadow tree, so the tab follows light/dark theme and the user's
 * accent colour without listening to anything. The look copies the "panel
 * language" of the Calibrations page around us (panel → header → body).
 *
 * Class names are short and unprefixed: the shadow root isolates them.
 */
export const styles = css`
  :host {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    min-width: 0;
    color: var(--text-primary);
    font-family: var(--font-family, inherit);
    font-size: var(--font-size-md);
    /* Width-based layout: the page area, not the window, decides (sidebars). */
    container-type: inline-size;
  }

  .panel {
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
    padding: var(--space-sm) var(--space-md);
    border-bottom: 1px solid var(--border-color);
  }
  .panel-title {
    flex: 1;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .panel-body {
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-width: 0;
  }

  .row { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; }
  .row.grow > input { flex: 1; min-width: 160px; }
  .muted { color: var(--text-muted); font-size: var(--font-size-sm); margin: 0; }
  .warn { color: var(--warning); font-size: var(--font-size-sm); margin: 0; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  p { margin: 0; }
  a { color: var(--accent); }
  b { font-weight: 600; }

  .chip {
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--border-color);
    background: var(--bg-surface-hover);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip.accent { border-color: var(--accent); color: var(--accent); font-weight: 600; }

  /* Provider switcher: same look as Calibrations' .sel-btn. */
  .sel-row { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
  .sel-btn {
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--font-size-sm);
    cursor: pointer;
  }
  .sel-btn:hover:not(:disabled) { background: var(--bg-surface-hover); }
  .sel-btn.active { background: var(--bg-surface-active); color: var(--accent); border-color: var(--accent); }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    padding: var(--space-xs) var(--space-md);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
    cursor: pointer;
    white-space: nowrap;
    text-decoration: none;
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text, #fff); }
  .btn:focus-visible, .sel-btn:focus-visible {
    outline: 2px solid var(--accent-ring, var(--accent));
    outline-offset: 1px;
  }

  input {
    min-width: 0;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
  }

  input.invalid { border-color: var(--danger); }

  .gcode {
    display: block;
    padding: var(--space-xs) var(--space-sm);
    background: var(--bg-surface-hover);
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: var(--font-size-sm);
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
  }

  ol.steps { margin: 0; padding-inline-start: 1.4em; display: flex; flex-direction: column; gap: var(--space-xs); }
  ol.steps li { color: var(--text-secondary); font-size: var(--font-size-sm); }
  ol.steps li .gcode { margin-top: 2px; }

  /* The provider's own UI. Its height is ours: the tab body has none. */
  iframe.frame {
    display: block;
    width: 100%;
    height: max(560px, 78dvh);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
  }
  .status { padding: var(--space-lg); text-align: center; color: var(--text-muted); }

  @container (max-width: 480px) {
    .panel-body { padding: var(--space-sm); }
    .panel-header { padding: var(--space-xs) var(--space-sm); }
    iframe.frame { height: max(480px, 80dvh); }
  }
  @media (pointer: coarse) {
    .sel-btn, .btn { min-height: 36px; }
  }
`;
