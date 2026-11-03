/**
 * Entry module of the Pressure Advance tester plugin (manifest.json → "entry").
 *
 * The host loads it with `import(entryUrl)` and then reads these NAMED EXPORTS:
 *
 *   locales         → merged into the host dictionary; api.i18n.t('patester.…')
 *   guardPaTester   → manifest guards[].handler, called by the GuardAgent
 *
 * Importing the module must also REGISTER every Custom Element named in
 * manifest.json: right after import the host may start creating elements by
 * tag — the overlay at once, the tab as soon as Calibrations shows it. The
 * chart element is not in the manifest: it is our own child inside the tab.
 *
 * The plugin adds a NEW TAB to the Calibrations page through the extension
 * point `@core/calibrations#tabs`. Nothing in it talks to Calibrations: the
 * manifest names the point, the host checks kind/version and mounts our
 * element with OUR api. There is no `available` export: the tab is always
 * shown, and explains how to get `[pa_tester]` when it is missing. See
 * base-element.ts and ui/pa-tab.ts.
 */
import { defineElement } from './base-element';
import en from './i18n/en';
import ru from './i18n/ru';
import { PaTesterBridge } from './ui/bridge';
import { PaForceChart } from './ui/force-chart';
import { PaTesterTab } from './ui/pa-tab';

// Tags must match manifest.json exactly. They are global for the whole page,
// hence the plugin prefix.
defineElement('tessera-pa-tester-tab', PaTesterTab);
defineElement('tessera-pa-tester-bridge', PaTesterBridge);
defineElement('tessera-pa-force-chart', PaForceChart);

export { guardPaTester } from './guard';

export const locales = { en, ru };
