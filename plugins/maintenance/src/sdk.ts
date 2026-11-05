/**
 * Host contracts, re-exported as types only.
 *
 * `export type` is erased at build time: the plugin never imports runtime code from the
 * host. Everything the plugin gets from Tessera arrives at runtime through the `api`
 * property the host sets on our Custom Elements.
 */
export type { KlippyRequestOptions, KlippyStreamStatus, MoonrakerProxyHandle, PluginApi } from '@tessera/sdk';
