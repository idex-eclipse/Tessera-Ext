import { css } from 'lit';

/**
 * Styles shared by the elements of the tab, adopted into each shadow root.
 *
 * Only the host's design tokens are used (--bg-surface, --accent, --space-*, ...,
 * docs/en/i18n-and-theming.md). They are CSS custom properties, which inherit into the
 * shadow tree, so the tab follows the light/dark theme and the user's accent without
 * listening to anything. The look copies the "panel language" of the Machine page
 * (panel -> header -> body) so the tab does not look foreign.
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
  /* Chips and buttons of a header. On the title's line they stay at the end; when they wrap
     onto their own line the auto margins centre them (there is free space only then). */
  .panel-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-sm);
    margin-inline: auto;
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
  .grow {
    flex: 1;
    min-width: 0;
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--font-size-sm);
    margin: 0;
  }
  .warn {
    color: var(--warning);
    font-size: var(--font-size-sm);
    margin: 0;
  }
  .error {
    color: var(--danger);
    font-size: var(--font-size-sm);
    margin: 0;
    overflow-wrap: anywhere;
  }
  .ok {
    color: var(--success);
    font-size: var(--font-size-sm);
    margin: 0;
  }
  /* Printer names, datasets and numbers read left-to-right in any UI direction. */
  .ltr {
    direction: ltr;
    unicode-bidi: isolate;
    overflow-wrap: anywhere;
  }

  /* Buttons copy the dashboard edit toolbar of the host (EditToolbar.svelte): filled, no
     border, the host's radius. Neutral = the hover surface, primary = the accent, danger =
     the danger colour. The height matches it too, and grows to a touch target on narrow widths. */
  button {
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
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    filter: brightness(1.12);
  }
  button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  button.primary {
    background: var(--accent);
    color: #fff;
  }
  button.danger {
    background: var(--danger);
    color: #fff;
  }
  button.small {
    min-block-size: 28px;
    padding: 2px var(--space-sm);
  }
  button.icon {
    min-inline-size: 28px;
    padding: 2px 6px;
  }
  /* Undo / redo: a square icon button like the dashboard's history buttons. */
  button.icon-btn {
    inline-size: var(--touch-target, 44px);
    padding: 0;
  }
  svg.flip {
    transform: scaleX(-1);
  }
  @container (max-width: 560px) {
    button {
      min-block-size: var(--touch-target, 44px);
    }
    button.small,
    button.icon {
      min-block-size: 36px;
    }
  }

  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: var(--space-sm);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .field-label {
    font-size: var(--font-size-sm);
    color: var(--text-secondary);
  }
  input,
  select {
    min-width: 0;
    min-block-size: 36px;
    padding: var(--space-xs) var(--space-sm);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-surface);
    color: var(--text-primary);
    font: inherit;
    font-size: var(--font-size-sm);
  }
  input[type='checkbox'] {
    min-block-size: 0;
    inline-size: 18px;
    block-size: 18px;
    accent-color: var(--accent);
  }
  input[type='range'] {
    min-block-size: 0;
    padding: 0;
  }
  input:focus-visible,
  select:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 1px;
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
  .chip.accent {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .bar {
    block-size: 6px;
    border-radius: 3px;
    background: var(--bg-surface-hover);
    overflow: hidden;
  }
  .bar > span {
    display: block;
    block-size: 100%;
    background: var(--accent);
  }
`;

/** Status colours and the progress bar variants of the maintenance cards. */
export const statusStyles = css`
  .bar.soon > span {
    background: var(--warning);
  }
  .bar.overdue > span {
    background: var(--danger);
  }
  .chip.soon {
    border-color: var(--warning);
    color: var(--warning);
  }
  .chip.overdue {
    border-color: var(--danger);
    color: var(--danger);
    font-weight: 600;
  }
`;
