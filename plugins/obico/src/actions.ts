import { hubFor } from './core/hub';
import type { PluginApi } from './sdk';

/**
 * The action of `@core/system#banner-status-actions` (manifest.json → extensions): a button
 * next to Pause / Resume / Cancel while the active printer prints.
 *
 * "Stop watching this print" mutes Obico's failure detection for the rest of the current
 * print, for a print the user knows looks strange (supports, a deliberately odd shape).
 * It changes nothing in Klipper, so it needs no guard.
 */

/** `available` export: only where Obico watches the current print of the active printer. */
export async function obicoMuteAvailable(api: PluginApi): Promise<boolean> {
  const hub = hubFor(api);
  // The hub may still be starting: wait for its first answer instead of saying "no" forever.
  if (hub.status === 'unknown') await hub.refresh();
  const printer = hub.printerFor(api.printer.id);
  return Boolean(printer?.current_print && !printer.current_print.alert_muted_at && printer.watching_enabled);
}

/** `handler` export: context `{ state, filename }` is not needed, the printer is the active one. */
export async function obicoMuteHandler(api: PluginApi): Promise<void> {
  const hub = hubFor(api);
  const printer = hub.printerFor(api.printer.id);
  if (!printer?.current_print) return;
  try {
    await hub.run((client) => client.mute(printer.id));
    api.notifications.push({ severity: 'info', text: api.i18n.t('obico.action.muted'), label: api.i18n.t('obico.tabTitle') });
  } catch (e) {
    api.notifications.push({
      severity: 'error',
      text: api.i18n.t('obico.error', { error: e instanceof Error ? e.message : String(e) }),
      label: api.i18n.t('obico.tabTitle'),
    });
  }
}
