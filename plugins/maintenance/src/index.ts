/**
 * Entry module of the Maintenance plugin (manifest.json -> "entry").
 *
 * The host loads it with `import(entryUrl)` and then reads the NAMED EXPORTS:
 *
 *   locales  -> merged into the host dictionary; api.i18n.t('maintenance.…')
 *
 * Importing the module must also REGISTER the Custom Elements named in manifest.json: right
 * after import the host may create them by tag. The other elements are our own children
 * inside the tab and are not in the manifest.
 *
 * The plugin adds a TAB to the Machine page through the extension point `@core/system#tabs`
 * and a WIDGET to the dashboard. Nothing in it talks to the System plugin: the manifest names
 * the point, the host checks kind/version and mounts our element with OUR api.
 */
import { defineElement } from './base-element';
import en from './i18n/en';
import ru from './i18n/ru';
import { MaintCard } from './ui/card';
import { MaintCameras } from './ui/cameras';
import { MaintChains } from './ui/chains';
import { MaintEditor } from './ui/editor';
import { MaintenanceOverlay } from './ui/overlay';
import { MaintenanceTab } from './ui/tab';
import { MaintenanceWidget } from './ui/widget';
import { MaintWizard } from './ui/wizard';

// Tags must match manifest.json exactly. They are global for the whole page, hence the prefix.
defineElement('tessera-maintenance-tab', MaintenanceTab);
defineElement('tessera-maintenance-widget', MaintenanceWidget);
defineElement('tessera-maint-card', MaintCard);
defineElement('tessera-maint-editor', MaintEditor);
defineElement('tessera-maint-wizard', MaintWizard);
defineElement('tessera-maint-cameras', MaintCameras);
defineElement('tessera-maint-chains', MaintChains);
defineElement('tessera-maintenance-overlay', MaintenanceOverlay);

export const locales = { en, ru };

/** Guard handler named in manifest.json: asks before a print starts. */
export { guardPrintStart } from './queue';
