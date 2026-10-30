import { useEffect, useState } from 'preact/hooks';

import type { PluginApi, PrinterInfo } from '../sdk';

/**
 * Host → plugin change notifications, bridged to Preact re-renders.
 *
 * The api getters (api.printer, api.i18n.locale) always return the current
 * value, but nothing tells Preact to re-render. These hooks subscribe to the
 * host events and return the unsubscribe from useEffect, so listeners are
 * released when the host unmounts the element.
 */

/** `t` that re-renders the component when the host language changes. */
export function useT(api: PluginApi): PluginApi['i18n']['t'] {
  const [, bump] = useState(0);
  useEffect(() => api.onLocaleChange(() => bump((n) => n + 1)), [api]);
  return (key, params) => api.i18n.t(key, params);
}

/**
 * The active printer. onPrinterChange is not fired when the active printer is
 * reset (null) or renamed, so registry changes are watched too.
 */
export function useActivePrinter(api: PluginApi): PrinterInfo {
  const [printer, setPrinter] = useState<PrinterInfo>(api.printer);
  useEffect(() => {
    const offActive = api.onPrinterChange(() => setPrinter(api.printer));
    const offAll = api.onPrintersChange(() => setPrinter(api.printer));
    return () => {
      offActive();
      offAll();
    };
  }, [api]);
  return printer;
}
