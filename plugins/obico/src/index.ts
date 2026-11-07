/**
 * Entry module of the Obico plugin (manifest.json -> "entry").
 *
 * The host loads it with `import(entryUrl)` and then reads the NAMED EXPORTS:
 *
 *   locales             -> merged into the host dictionary; api.i18n.t('obico.…')
 *   obicoMuteHandler    -> handler of the print banner action (@core/system#banner-status-actions)
 *   obicoMuteAvailable  -> its `available`
 *
 * Importing the module must also REGISTER the Custom Elements named in manifest.json: right
 * after import the host may create them by tag (the overlay at once).
 *
 * Two levels:
 * - through Moonraker only (works with Obico Cloud and self-hosted): the Obico tab of the
 *   Machine page with the link, the moonraker-obico service and the tunnel;
 * - through the Obico server API (self-hosted, with an access token): the failure
 *   probability chip, the detection and statistics widgets, the fleet panel, the alert
 *   window and the print banner action. The server sends no CORS headers, so every API
 *   call goes through Tessera's service proxy (`api.services`, manifest.services).
 */
import { defineElement } from './base-element';
import en from './i18n/en';
import ru from './i18n/ru';
import { ObicoApiPanels } from './ui/api-panels';
import { ObicoChip, ObicoChipPicker } from './ui/chip';
import { ObicoDetectionHeader } from './ui/detection-header';
import { ObicoDetectionWidget } from './ui/detection-widget';
import { ObicoFleetPanel } from './ui/fleet-panel';
import { ObicoOverlay } from './ui/overlay';
import { ObicoSnapshot } from './ui/parts';
import { ObicoStatsWidget } from './ui/stats-widget';
import { ObicoTab } from './ui/tab';

// Tags must match manifest.json exactly. They are global for the whole page, hence the prefix.
defineElement('tessera-obico-tab', ObicoTab);
defineElement('tessera-obico-overlay', ObicoOverlay);
defineElement('tessera-obico-detection-widget', ObicoDetectionWidget);
defineElement('tessera-obico-detection-header', ObicoDetectionHeader);
defineElement('tessera-obico-stats-widget', ObicoStatsWidget);
defineElement('tessera-obico-chip', ObicoChip);
defineElement('tessera-obico-chip-picker', ObicoChipPicker);
defineElement('tessera-obico-fleet-panel', ObicoFleetPanel);
// Our own children, not in the manifest.
defineElement('tessera-obico-api', ObicoApiPanels);
defineElement('tessera-obico-snapshot', ObicoSnapshot);

export { obicoMuteAvailable, obicoMuteHandler } from './actions';

export const locales = { en, ru };
