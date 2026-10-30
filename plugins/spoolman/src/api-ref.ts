import { signal } from '@preact/signals';

import type { PluginApi } from './sdk';

/**
 * Module-level reference to this plugin's PluginApi.
 *
 * WHY: the host hands `api` only to Custom Elements (as a property). Guard
 * handlers are plain module exports called as `(request, token, ctx)` — they
 * receive NO api. So the first element that connects stores its api here and
 * the guard reads it.
 *
 * The overlay element is mounted by the host permanently (on every page, from
 * app start), which makes it the reliable source: by the time the user can
 * press "Print", the overlay has connected and this signal is set. Any other
 * surface (page/widget) refreshes it too — all of them receive the same
 * plugin-scoped api object.
 *
 * The api object is long-lived: its getters (printer, locale, theme) always
 * read the current host state, so keeping it in module state is safe.
 */
export const apiRef = signal<PluginApi | null>(null);

const connectListeners = new Set<(api: PluginApi) => void>();

export function setApi(api: PluginApi): void {
  const first = apiRef.peek() === null;
  apiRef.value = api;
  if (first) for (const cb of connectListeners) cb(api);
}

/** Runs `cb` once the plugin has an api (immediately if it already has one). */
export function onApiReady(cb: (api: PluginApi) => void): void {
  const api = apiRef.peek();
  if (api) cb(api);
  else connectListeners.add(cb);
}
