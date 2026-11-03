/**
 * Host contracts, re-exported as types only.
 *
 * `export type` is erased at build time: the plugin never imports runtime code
 * from the host. Everything the plugin gets from Tessera arrives at runtime
 * through the `api` property the host sets on our Custom Elements (and as the
 * first argument of the `available` export, see availability.ts).
 */
export type {
  GuardContext,
  GuardDecision,
  MoonrakerProxyHandle,
  MpuParams,
  PluginApi,
  PrinterInfo,
} from '@tessera/sdk';
