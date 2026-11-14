import { PROVIDERS, providerById, type Provider, type ProviderId } from './providers';

/** `api.settingsFor` keys (per printer, the host decides about sync). */
export const SETTING_PROVIDER = 'provider';
export const settingUrl = (id: ProviderId): string => `url.${id}`;

/**
 * Provider shown first: the last choice if it is still installed, otherwise
 * the first installed one in table order (autopa before KAPAT). null — none.
 */
export function pickProvider(installed: readonly ProviderId[], saved: unknown): Provider | null {
  if (typeof saved === 'string' && installed.includes(saved as ProviderId)) return providerById(saved) ?? null;
  const first = PROVIDERS.find((p) => installed.includes(p.id));
  return first ?? null;
}
