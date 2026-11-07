import { css } from 'lit';

/**
 * Styles of the tab, adopted into its shadow root.
 *
 * Only the host's design tokens are used (--bg-surface, --accent, --space-*, ...,
 * docs/en/i18n-and-theming.md). They are CSS custom properties, which inherit into the
 * shadow tree, so the tab follows the light/dark theme and the user's accent without
 * listening to anything. The look copies the "panel language" of the Machine page
 * (panel -> header -> body), the same subset the Maintenance plugin uses.
 *
 * Layout uses logical properties (inline/block, start/end) so it mirrors in RTL, and
 * wraps by the width of the tab's own container, not of the window (a sidebar may take
 * half of it), down to about 360px.
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
    flex-wrap: wrap;
    gap: var(--space-sm);
    padding: var(--space-sm) var(--space-md);
    border-block-end: 1px solid var(--border-color);
  }
  /* A title never shrinks below ~14em: a long title takes its own line and the chips and
     buttons wrap under it, instead of being squeezed into a column of single letters. */
  .panel-title {
    flex: 1 1 14em;
    min-width: 0;
    font-size: var(--font-size-md);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .panel-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-sm);
  }
  .panel-body {
    padding: var(--space-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
    min-width: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-wrap: wrap;
  }
  .label {
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
  }
  p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
  }
  .warn {
    color: var(--warning);
    font-size: var(--font-size-sm);
  }
  .error {
    color: var(--danger);
    font-size: var(--font-size-sm);
  }
  .ok {
    color: var(--success);
    font-size: var(--font-size-sm);
  }
  /* URLs, ports, service names, codes and log lines read left-to-right in any UI direction. */
  .ltr {
    direction: ltr;
    unicode-bidi: isolate;
    overflow-wrap: anywhere;
  }

  /* The link code is typed by hand into another app: large, monospace, easy to read out. */
  .code {
    font-family: ui-monospace, monospace;
    font-size: 1.6em;
    font-weight: 600;
    letter-spacing: 0.15em;
  }

  /* Config snippets and the log: monospace, left-to-right, scrolled inside their own box so
     long lines never widen the page on a narrow screen. */
  pre {
    margin: 0;
    padding: var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface-hover);
    font-family: ui-monospace, monospace;
    font-size: var(--font-size-sm);
    direction: ltr;
    text-align: left;
    unicode-bidi: isolate;
    overflow: auto;
    white-space: pre;
  }
  pre.snippet {
    user-select: all;
  }
  pre.log {
    max-block-size: 320px;
  }

  /* Buttons copy the dashboard edit toolbar of the host (EditToolbar.svelte), like the
     other Tessera-Ext plugins. Links styled as buttons open the Obico web app. */
  button,
  a.button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-xs);
    min-block-size: 32px;
    padding: var(--space-xs) var(--space-md);
    border: none;
    border-radius: var(--radius-md);
    background: var(--bg-surface-hover);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
    text-decoration: none;
    cursor: pointer;
  }
  button:hover:not(:disabled),
  a.button:hover {
    filter: brightness(1.12);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  button.primary,
  a.button.primary {
    background: var(--accent);
    color: #fff;
  }
  button.danger {
    background: var(--danger);
    color: #fff;
  }
  button:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 1px;
  }
  /* Touch targets on narrow widths. */
  @container (max-width: 560px) {
    button,
    a.button {
      min-block-size: var(--touch-target, 44px);
    }
  }
  a:not(.button) {
    color: var(--accent);
  }

  .chip {
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--border-color);
    background: var(--bg-surface-hover);
    color: var(--text-secondary);
    font-size: var(--font-size-sm);
    white-space: nowrap;
  }
  .chip.live {
    border-color: var(--success);
    color: var(--success);
  }
  .chip.bad {
    border-color: var(--danger);
    color: var(--danger);
  }
  .chip.warn {
    border-color: var(--warning);
    color: var(--warning);
  }

  /* The inline confirmation of a destructive action, instead of a native confirm() that
     ignores the theme and blocks the page. */
  .confirm {
    padding: var(--space-sm);
    border: 1px solid var(--danger);
    border-radius: var(--radius-sm);
    display: flex;
    flex-direction: column;
    gap: var(--space-sm);
  }
`;
