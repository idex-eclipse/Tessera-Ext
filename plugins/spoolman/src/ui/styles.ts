/**
 * Plugin CSS, injected once into <head>.
 *
 * Only the host's theme tokens are used (--bg-surface, --accent, --space-*, …):
 * they switch with light/dark theme and the user's accent colour, so the
 * plugin follows the host without listening to onThemeChange. All classes are
 * prefixed `spm-` because our elements live in the page's light DOM, next to
 * the host's and other plugins' styles.
 */
const CSS = `
.spm-root { display: flex; flex-direction: column; gap: var(--space-sm); min-height: 0; height: 100%;
  color: var(--text-primary); font-family: var(--font-family); font-size: var(--font-size-md); }
.spm-muted { color: var(--text-muted); font-size: var(--font-size-sm); }
.spm-warn { color: var(--warning); font-size: var(--font-size-sm); }
.spm-error { color: var(--danger); font-size: var(--font-size-sm); }
.spm-ok { color: var(--success); font-size: var(--font-size-sm); }

.spm-btn { padding: var(--space-xs) var(--space-md); border: none; border-radius: var(--radius-md);
  background: var(--bg-surface-hover-no-override); color: var(--text-primary);
  font: inherit; font-size: var(--font-size-sm); cursor: pointer; white-space: nowrap; }
.spm-btn:hover { background: var(--bg-surface-hover); }
.spm-btn:focus-visible, .spm-input:focus-visible { outline: 2px solid var(--accent-ring); outline-offset: 1px; }
.spm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.spm-btn-primary { background: var(--accent); color: var(--accent-text); }
.spm-btn-primary:hover { background: var(--accent-hover); }
.spm-btn-danger { background: var(--danger); color: #fff; }
.spm-icon-btn { padding: var(--space-xs); background: transparent; color: var(--text-secondary); line-height: 0; }
.spm-icon-btn svg { width: 18px; height: 18px; }

.spm-input { padding: var(--space-xs) var(--space-sm); border: 1px solid var(--border-color);
  border-radius: var(--radius-md); background: var(--bg-surface); color: var(--text-primary); font: inherit; min-width: 0; }

.spm-swatch { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
  border: 1px solid var(--border-color); box-shadow: inset 0 0 0 4px var(--bg-surface); }
.spm-swatch-empty { background: repeating-linear-gradient(45deg, transparent 0 4px, var(--border-color) 4px 5px); }

.spm-spool { display: flex; align-items: center; gap: var(--space-sm); min-width: 0; }
.spm-spool-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.spm-spool-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.spm-bar { height: 4px; border-radius: 2px; background: var(--bg-surface-hover-no-override); overflow: hidden; margin-top: 2px; }
.spm-bar > span { display: block; height: 100%; background: var(--accent); }
.spm-bar.low > span { background: var(--warning); }

.spm-tools { display: flex; flex-direction: column; gap: var(--space-sm); overflow: auto; min-height: 0; }
.spm-tool { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border-color); border-radius: var(--radius-md); }
.spm-tool-label { font-weight: 600; color: var(--text-secondary); min-width: 2.2em; }
.spm-tool .spm-spool { flex: 1; }

.spm-header { display: flex; gap: var(--space-xs); align-items: center; }

/* Overlay: the host layer is pointer-events:none and full-screen; we draw our
   own backdrop + dialog and render NOTHING while closed (see Overlay.tsx). */
.spm-backdrop { position: fixed; inset: 0; background: var(--bg-overlay);
  display: flex; align-items: center; justify-content: center; padding: var(--space-md); }
.spm-dialog { width: min(560px, 100%); max-height: min(720px, 100%); display: flex; flex-direction: column;
  background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); overflow: hidden;
  color: var(--text-primary); font-family: var(--font-family); }
.spm-dialog-header { padding: var(--space-md) var(--space-lg); border-bottom: 1px solid var(--border-color); }
.spm-dialog-header h3 { margin: 0; font-size: var(--font-size-lg); font-weight: 600; }
.spm-dialog-body { padding: var(--space-md) var(--space-lg); display: flex; flex-direction: column;
  gap: var(--space-sm); overflow: auto; min-height: 0; }
.spm-dialog-footer { display: flex; justify-content: flex-end; gap: var(--space-sm); flex-wrap: wrap;
  padding: var(--space-md) var(--space-lg); border-top: 1px solid var(--border-color); }
.spm-check-tool { display: flex; flex-direction: column; gap: var(--space-xs); padding: var(--space-sm);
  border: 1px solid var(--border-color); border-radius: var(--radius-md); }
.spm-check-tool.has-issue { border-color: var(--warning); }

.spm-picker { display: flex; flex-direction: column; gap: var(--space-sm); min-height: 0; }
.spm-picker-list { display: flex; flex-direction: column; gap: 2px; overflow: auto; max-height: 320px; }
.spm-picker-item { display: block; width: 100%; text-align: start; padding: var(--space-xs) var(--space-sm);
  border: 1px solid transparent; border-radius: var(--radius-md); background: transparent;
  color: inherit; font: inherit; cursor: pointer; }
.spm-picker-item:hover { background: var(--bg-surface-hover); }
.spm-picker-item.current { border-color: var(--accent); background: var(--bg-surface-active); }

.spm-page { display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md); }
.spm-page-bar { display: flex; gap: var(--space-sm); align-items: center; flex-wrap: wrap; }
.spm-page-bar .spm-input { flex: 1; min-width: 200px; }
.spm-frame { width: 100%; height: calc(100dvh - 180px); min-height: 420px; border: 1px solid var(--border-color);
  border-radius: var(--radius-md); background: var(--bg-surface); }

@media (pointer: coarse) {
  .spm-btn { padding: var(--space-sm) var(--space-md); }
  .spm-picker-item { padding: var(--space-sm); }
}
`;

let injected = false;

export function injectStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.dataset.plugin = 'tessera/spoolman';
  style.textContent = CSS;
  document.head.append(style);
}
