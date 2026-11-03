/**
 * Entry module of the Shake&Tune plugin (manifest.json → "entry").
 *
 * The host loads it with `import(entryUrl)` (entry resolved relative to the
 * manifest URL) and then reads these NAMED EXPORTS:
 *
 *   locales         → merged into the host dictionary; api.i18n.t('shaketune.…')
 *   hasShakeTune    → manifest extensions[].available: is the contribution
 *                     usable on the active printer ([shaketune] configured)?
 *   guardShakeTune  → manifest guards[].handler, called by the GuardAgent
 *
 * Importing the module must also REGISTER every Custom Element named in
 * manifest.json: right after import the host may start creating elements by
 * tag — the overlay at once, the tab as soon as Calibrations shows the Input
 * Shaper tab. Side effects at import time are therefore intended here.
 *
 * This is the first plugin whose main UI lives INSIDE another plugin. Nothing
 * in it talks to Calibrations: the manifest names the extension point, the host
 * checks kind/version, asks `hasShakeTune`, and mounts our element where the
 * owner placed the point — with OUR api. See base-element.ts and ui/st-tab.ts.
 */
import { defineElement } from './base-element';
import en from './i18n/en';
import ru from './i18n/ru';
import { ShakeTuneBridge } from './ui/bridge';
import { ShakeTuneTab } from './ui/st-tab';

// Tags must match manifest.json exactly. They are global for the whole page,
// hence the plugin prefix.
defineElement('tessera-shaketune-tab', ShakeTuneTab);
defineElement('tessera-shaketune-bridge', ShakeTuneBridge);

export { hasShakeTune } from './availability';
export { guardShakeTune } from './guard';

export const locales = { en, ru };
