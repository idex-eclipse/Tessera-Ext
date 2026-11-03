import type { Provider } from './providers';

/**
 * Where a provider's web UI lives, as seen from the browser.
 *
 * Both installers put `/autopa/` / `/kapat/` into the FIRST nginx site they
 * find with a matching `location`/`listen`. That may be the Tessera site
 * (same origin as this page) or the Mainsail/Fluidd site on port 80 — we
 * cannot know which, so we try the likely addresses in order and let the
 * user type their own.
 */

export interface AddressContext {
  /** Address the user typed for this provider (settings), if any. */
  manual?: string;
  /** `location.origin` of the Tessera page. */
  pageOrigin: string;
  /** `api.printer.url`: Moonraker's address, only its host is used. */
  printerUrl: string;
}

/** Host of the printer without port; IPv6 keeps its brackets. null if the URL is unusable. */
export function printerHost(printerUrl: string): string | null {
  try {
    const host = new URL(printerUrl).hostname;
    return host || null;
  } catch {
    return null;
  }
}

/** What the user typed → absolute URL (`printer.local:8080/kapat/` gets `http://`), or null. */
export function normalizeManual(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Addresses to try, best first:
 *   1. the user's own address;
 *   2. this page's origin + path (Tessera's site got the location);
 *   3. the printer's host on the default port of the page's scheme (the
 *      Mainsail/Fluidd site, usually port 80).
 * Duplicates are dropped (a page already served from the printer's port 80).
 */
export function candidates(provider: Provider, ctx: AddressContext): string[] {
  const out: string[] = [];
  const add = (url: string | null): void => {
    if (url && !out.includes(url)) out.push(url);
  };

  add(normalizeManual(ctx.manual));

  let pageProtocol = 'http:';
  try {
    pageProtocol = new URL(ctx.pageOrigin).protocol;
    add(new URL(provider.path, ctx.pageOrigin).href);
  } catch {
    // pageOrigin is "null" in sandboxed documents: no same-origin candidate.
  }

  const host = printerHost(ctx.printerUrl);
  if (host) add(new URL(provider.path, `${pageProtocol}//${host}`).href);
  return out;
}

/** An HTTP address inside an HTTPS page: the browser refuses to load it. */
export function isMixedContent(url: string, pageProtocol: string): boolean {
  return pageProtocol === 'https:' && /^http:/i.test(url);
}

export function sameOrigin(url: string, pageOrigin: string): boolean {
  try {
    return new URL(url).origin === pageOrigin;
  } catch {
    return false;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'text'>>;

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await run(ctl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Does something answer at `url`?
 *
 * - Same origin: a real GET. The status is readable, but Tessera's own nginx
 *   site may answer any unknown path with its index.html (SPA fallback), so a
 *   200 only counts if the body differs from the site's root page.
 * - Other origin: `no-cors` fetch. The response is opaque, so a 404 cannot be
 *   told from a UI; but a refused connection, a timeout or a mixed-content
 *   block rejects. It tells "something is listening", nothing more — and the
 *   iframe's `load` event cannot do better: it fires for error pages too.
 */
export async function probe(
  url: string,
  pageOrigin: string,
  timeoutMs = 4000,
  fetchFn: FetchLike = (input, init) => fetch(input, init),
): Promise<boolean> {
  try {
    const pageProtocol = pageOrigin.startsWith('https:') ? 'https:' : 'http:';
    if (isMixedContent(url, pageProtocol)) return false;

    if (!sameOrigin(url, pageOrigin)) {
      await withTimeout((signal) => fetchFn(url, { mode: 'no-cors', cache: 'no-store', signal }), timeoutMs);
      return true;
    }

    const res = await withTimeout((signal) => fetchFn(url, { cache: 'no-store', signal }), timeoutMs);
    if (!res.ok) return false;
    const [page, root] = await Promise.all([
      res.text(),
      withTimeout((signal) => fetchFn(`${pageOrigin}/`, { cache: 'no-store', signal }), timeoutMs).then((r) =>
        r.ok ? r.text() : '',
      ),
    ]);
    return page.trim() !== '' && page !== root;
  } catch {
    return false;
  }
}

export interface Resolved {
  /** First address that answered, or the user's own address (not probed). */
  url: string | null;
  /** True when `url` is the address the user typed: no fallback is attempted. */
  manual: boolean;
  /** Everything that was tried, in order. */
  tried: string[];
}

/**
 * First address that answers. The user's own address is trusted as is: they
 * typed it on purpose, and a wrong one is better shown (with an error inside
 * the frame) than silently replaced by another provider site.
 */
export async function resolveUrl(
  provider: Provider,
  ctx: AddressContext,
  probeFn: (url: string) => Promise<boolean> = (u) => probe(u, ctx.pageOrigin),
): Promise<Resolved> {
  const manual = normalizeManual(ctx.manual);
  if (manual) return { url: manual, manual: true, tried: [manual] };

  const tried: string[] = [];
  for (const url of candidates(provider, ctx)) {
    tried.push(url);
    if (await probeFn(url)) return { url, manual: false, tried };
  }
  return { url: null, manual: false, tried };
}
