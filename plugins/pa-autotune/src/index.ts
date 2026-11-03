/**
 * Entry module of the PA Autotune plugin (manifest.json → "entry").
 *
 * The host loads it with `import(entryUrl)` and then reads these NAMED EXPORTS:
 *
 *   locales          → merged into the host dictionary; api.i18n.t('paautotune.…')
 *   guardPaAutotune  → manifest guards[].handler, called by the GuardAgent
 *
 * Importing the module must also REGISTER every Custom Element named in
 * manifest.json: right after import the host may start creating elements by
 * tag — the overlay at once, the tab as soon as Calibrations shows it.
 *
 * The plugin adds a NEW TAB to the Calibrations page through the extension
 * point `@core/calibrations#tabs`. There is no `available` export on purpose:
 * the tab is always there, and shows installation instructions while neither
 * autopa nor KAPAT is installed. See base-element.ts and ui/autotune-tab.ts.
 */
import { defineElement } from './base-element';
import en from './i18n/en';
import ru from './i18n/ru';
import { PaAutotuneBridge } from './ui/bridge';
import { PaAutotuneTab } from './ui/autotune-tab';

// Tags must match manifest.json exactly. They are global for the whole page,
// hence the plugin prefix.
defineElement('tessera-pa-autotune-tab', PaAutotuneTab);
defineElement('tessera-pa-autotune-bridge', PaAutotuneBridge);

export { guardPaAutotune } from './guard';

export const locales = { en, ru };
