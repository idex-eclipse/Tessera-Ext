import { css } from 'lit';

/**
 * Styles of the tab, adopted into its shadow root (Lit `static styles`).
 *
 * Only the host's design tokens are used (--bg-surface, --accent, --space-*, …,
 * docs/en/i18n-and-theming.md). They are CSS custom properties, which inherit
 * into the shadow tree, so the tab follows light/dark theme and the user's
 * accent colour without listening to anything. The look copies the "panel
 * language" of the Calibrations page around us (panel → header → body), so the
 * replaced tab does not look foreign.
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
  .muted { color: var(--text-muted); font-size: var(--font-size-sm); margin: 0; }
  .warn { color: var(--warning); font-size: var(--font-size-sm); margin: 0; }
  .error { color: var(--danger); font-size: var(--font-size-sm); margin: 0; }
  .ok { color: var(--success); font-size: var(--font-size-sm); margin: 0; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

  .chip {
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--border-color);
    background: var(--bg-surface-hover);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }
  .chip.accent { border-color: var(--accent); color: var(--accent); font-weight: 600; }

  /* Command selector + gallery filters: same look as Calibrations' .sel-btn. */
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
  .sel-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .sel-btn.active { background: var(--bg-surface-active); color: var(--accent); border-color: var(--accent); }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--space-sm);
  }
  .field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .field-label { font-size: var(--font-size-sm); color: var(--text-secondary); }
  .field.invalid .field-label { color: var(--danger); }
  input, select {
    min-width: 0;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
  }
  .field.invalid input { border-color: var(--danger); }
  input.num { inline-size: 7rem; }
  /* checkbox rows and uncaptioned controls sit on the baseline of the captioned fields */
  .check {
    display: inline-flex;
    align-items: center;
    gap: var(--space-xs);
    align-self: flex-end;
    min-height: 32px;
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .end { align-self: flex-end; }
  .chip.warn-chip { border-color: var(--warning); color: var(--warning); white-space: normal; }

  .gcode {
    display: block;
    padding: var(--space-xs) var(--space-sm);
    background: var(--bg-surface-hover-no-override, var(--bg-surface-hover));
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
    user-select: text;
  }

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
  }
  .btn:hover:not(:disabled) { background: var(--bg-surface-active); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text, #fff); }
  .btn:focus-visible, .sel-btn:focus-visible {
    outline: 2px solid var(--accent-ring, var(--accent));
    outline-offset: 1px;
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
  }
  .icon-btn:hover { background: var(--bg-surface-hover); color: var(--text-primary); }
  .icon-btn.active { background: var(--accent); color: var(--accent-text, #fff); }
  .icon-btn svg { display: block; }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    flex-shrink: 0;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .card {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: var(--space-sm);
    display: flex;
    flex-direction: column;
    gap: var(--space-xs);
  }
  .card h4 { margin: 0; font-size: var(--font-size-sm); font-weight: 600; }

  table { width: 100%; border-collapse: collapse; font-size: var(--font-size-sm); }
  th, td { padding: var(--space-xs) var(--space-sm); text-align: start; border-bottom: 1px solid var(--border-color); }
  th { color: var(--text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }

  details.log summary { cursor: pointer; color: var(--text-secondary); font-size: var(--font-size-sm); }
  details.log pre {
    margin: var(--space-xs) 0 0;
    max-height: 200px;
    overflow: auto;
    padding: var(--space-sm);
    background: var(--bg-surface-hover);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }
  details.log pre .err { color: var(--danger); }

  /*
   * Help popover: same look as the host's HeaderHelp. It is a [popover] in the
   * top layer (see #placeHelp in pa-tab.ts); the UA style centres popovers
   * (inset: 0; margin: auto), we drop that and set top/left/right from JS.
   */
  .help-menu {
    position: fixed;
    inset: auto;
    margin: 0;
    min-width: min(280px, calc(100vw - 16px));
    max-width: min(380px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    padding: var(--space-sm);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15));
    color: var(--text-primary);
    font-family: var(--font-family, inherit);
  }
  .help-menu:popover-open { display: flex; flex-direction: column; gap: var(--space-sm); }
  .help-title {
    padding: var(--space-xs) var(--space-sm);
    font-size: var(--font-size-sm);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }
  .help-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    padding: 0 var(--space-sm) var(--space-xs);
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
    line-height: 1.5;
  }
  .help-body h4 { margin: var(--space-xs) 0 2px; color: var(--text-primary); font-size: var(--font-size-sm); font-weight: 600; }
  .help-body p { margin: 0; }

  .gcode-row { display: flex; gap: var(--space-sm); align-items: stretch; }
  .gcode-row .gcode { flex: 1; min-width: 0; }
  ol.steps { margin: 0; padding-inline-start: 1.4em; display: flex; flex-direction: column; gap: var(--space-xs); }
  ol.steps li { color: var(--text-secondary); font-size: var(--font-size-sm); }
  ol.steps li .gcode { margin-top: 2px; }
  a { color: var(--accent); }
  .row.end { justify-content: flex-end; }
  b { font-weight: 600; }

  /*
   * Confirmation of PA_CALIBRATE: a native <dialog> opened with showModal()
   * lives in the browser's TOP LAYER. The Calibrations page is a size container
   * (container-type), which makes it the containing block of position:fixed
   * descendants, so a fixed div of ours would be clipped to the page area.
   */
  dialog.confirm {
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: var(--font-family, inherit);
    max-width: min(460px, 94vw);
  }
  dialog.confirm::backdrop { background: var(--bg-overlay, rgba(0, 0, 0, 0.6)); }
  .confirm-body { display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md); }
  .confirm-body h3 { margin: 0; font-size: var(--font-size-md); }
  .confirm-body p { margin: 0; color: var(--text-secondary); font-size: var(--font-size-sm); }

  @container (max-width: 480px) {
    .panel-body { padding: var(--space-sm); }
    .fields { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }
  }
  @media (pointer: coarse) {
    .icon-btn { width: 36px; height: 36px; }
    .sel-btn, .btn, .check, select, input.num { min-height: 36px; }
  }
`;
