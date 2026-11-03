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
  .btn:focus-visible, .sel-btn:focus-visible, .tile:focus-visible {
    outline: 2px solid var(--accent-ring, var(--accent));
    outline-offset: 1px;
  }
  .icon-btn {
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

  details.help { position: relative; }
  details.help summary { list-style: none; }
  details.help summary::-webkit-details-marker { display: none; }
  .help-body {
    position: absolute;
    inset-inline-end: 0;
    top: calc(100% + 4px);
    z-index: 5;
    width: min(360px, calc(100cqw - 32px));
    max-height: 60vh;
    overflow: auto;
    padding: var(--space-sm) var(--space-md);
    background: var(--bg-surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.15));
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  .help-body h4 { margin: var(--space-sm) 0 2px; color: var(--text-primary); font-size: var(--font-size-sm); }
  .help-body p { margin: 0; line-height: 1.45; }

  .gallery { display: flex; gap: var(--space-xs); flex-wrap: wrap; }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
    max-width: 230px;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .tile:hover { background: var(--bg-surface-hover); }
  .tile.active { border-color: var(--accent); color: var(--accent); }
  .tile.fresh { border-style: dashed; border-color: var(--accent); }
  .tile-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag {
    padding: 0 5px;
    border-radius: 4px;
    background: var(--bg-surface-active);
    color: var(--accent);
    font-size: 10px;
    font-weight: 600;
  }
  .tag.new { background: var(--accent); color: var(--accent-text, #fff); }

  .preview {
    max-width: 100%;
    max-height: min(520px, 70dvh);
    object-fit: contain;
    align-self: flex-start;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: #fff; /* Shake&Tune graphs are drawn on white */
    cursor: zoom-in;
  }

  /*
   * Lightbox: a native <dialog> opened with showModal() lives in the browser's
   * TOP LAYER. That matters here: the Calibrations page is a size container
   * (container-type), which makes it the containing block of position:fixed
   * descendants — a fixed div of ours would be clipped to the page area.
   * The top layer is above everything regardless of ancestors.
   */
  dialog {
    padding: 0;
    border: none;
    border-radius: var(--radius-lg);
    background: #fff;
    max-width: 96vw;
    max-height: 94vh;
    overflow: auto;
  }
  dialog::backdrop { background: var(--bg-overlay, rgba(0, 0, 0, 0.6)); }
  dialog img { display: block; }
  dialog img.fit { max-width: 94vw; max-height: 92vh; object-fit: contain; cursor: zoom-in; }
  dialog img.full { cursor: zoom-out; }

  @container (max-width: 480px) {
    .panel-body { padding: var(--space-sm); }
    .fields { grid-template-columns: repeat(auto-fill, minmax(100px, 1fr)); }
  }
  @media (pointer: coarse) {
    .icon-btn { width: 36px; height: 36px; }
    .sel-btn, .btn { min-height: 36px; }
  }
`;
