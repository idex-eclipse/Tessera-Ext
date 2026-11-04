/**
 * Entry module of the Motion diagnostics plugin (manifest.json -> "entry").
 *
 * The host loads it with `import(entryUrl)` and then reads the NAMED EXPORTS:
 *
 *   locales  -> merged into the host dictionary; api.i18n.t('motiondiag.…')
 *
 * Importing the module must also REGISTER the Custom Element named in manifest.json: right
 * after import the host may create it by tag. The other elements are our own children
 * inside the tab and are not in the manifest.
 *
 * The plugin adds a TAB to the Machine page through the extension point
 * `@core/system#tabs`. Nothing in it talks to the System plugin: the manifest names the
 * point, the host checks kind/version and mounts our element with OUR api.
 */
import { defineElement } from './base-element';
import en from './i18n/en';
import ru from './i18n/ru';
import { CapturePanel } from './ui/capture-panel';
import { DatasetDialog } from './ui/dataset-dialog';
import { GraphsPanel } from './ui/graphs-panel';
import { GraphView } from './ui/graph-view';
import { SavePanel } from './ui/save-panel';
import { MotionDiagTab } from './ui/tab';

// Tags must match manifest.json exactly. They are global for the whole page, hence the prefix.
defineElement('tessera-motion-diag-tab', MotionDiagTab);
defineElement('tessera-md-capture', CapturePanel);
defineElement('tessera-md-graphs-panel', GraphsPanel);
defineElement('tessera-md-graphs', GraphView);
defineElement('tessera-md-save', SavePanel);
defineElement('tessera-md-dataset-dialog', DatasetDialog);

export const locales = { en, ru };
