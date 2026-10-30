/**
 * Entry module of the Spoolman plugin (manifest.json → "entry").
 *
 * The host loads it with `import(entryUrl)` (entry resolved relative to the
 * manifest URL) and then reads these NAMED EXPORTS:
 *
 *   locales          → merged into the host dictionary; api.i18n.t('spoolman.…')
 *   pageIcons        → manifest pages[].icon "spool" is looked up here and
 *                      becomes the sidebar icon (raw SVG string)
 *   guardPrintStart  → manifest guards[].handler, called by the GuardAgent
 *
 * Importing the module must also REGISTER every Custom Element named in
 * manifest.json: right after import the host starts creating elements by tag.
 * Side effects at import time are therefore intended here.
 */
import { onApiReady } from './api-ref';
import { defineElement } from './element';
import en from './i18n/en';
import ru from './i18n/ru';
import { startTracker } from './tracker';
import { Overlay } from './ui/Overlay';
import { Page } from './ui/Page';
import { injectStyles } from './ui/styles';
import { Widget } from './ui/Widget';
import { WidgetHeader } from './ui/WidgetHeader';

injectStyles();

// Tags must match manifest.json exactly. They are global for the whole page,
// hence the plugin prefix.
defineElement('tessera-spoolman-page', Page);
defineElement('tessera-spoolman-widget', Widget);
defineElement('tessera-spoolman-widget-header', WidgetHeader);
defineElement('tessera-spoolman-overlay', Overlay);

// Start tracking all printers as soon as any surface hands us the api
// (normally the always-mounted overlay, right after the app starts).
onApiReady(startTracker);

export { guardPrintStart } from './guard';

export const locales = { en, ru };

export const pageIcons: Record<string, string> = {
  spool:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>' +
    '<path d="M12 3v4"/><path d="M12 17v4"/></svg>',
};
