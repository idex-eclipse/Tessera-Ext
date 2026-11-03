import type { PluginApi } from './sdk';

/**
 * Module-level reference to this plugin's PluginApi.
 *
 * WHY: the host hands `api` to Custom Elements (as a property) and to the
 * `available` export (as an argument). The guard handler is a plain module
 * export called as `(request, token, ctx)` — it receives NO api. So whoever
 * gets the api first stores it here and the guard reads it.
 *
 * Our tab is mounted only while the user looks at the PA Autotune tab, which
 * may be never in a session — yet an autopa or KAPAT command typed in the console
 * must still be checked. That is why the plugin also has an always-mounted,
 * empty overlay (`tessera-pa-autotune-bridge`, see index.ts): the host mounts it
 * at app start, so the api is here before anyone can send a command.
 *
 * The api object is long-lived: its getters (printer, locale, theme) always
 * read the current host state, so keeping it in module state is safe.
 */
let current: PluginApi | null = null;

export function setApi(api: PluginApi): void {
  current = api;
}

export function getApi(): PluginApi | null {
  return current;
}
