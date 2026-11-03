import { describe, expect, it, vi } from 'vitest';

import { PROVIDERS, providerById } from '../providers';
import { candidates, isMixedContent, normalizeManual, printerHost, probe, resolveUrl, type FetchLike } from '../url';

const autopa = providerById('autopa')!;
const kapat = providerById('kapat')!;

describe('printerHost', () => {
  it('takes the host without the Moonraker port', () => {
    expect(printerHost('http://printer.local:7125')).toBe('printer.local');
    expect(printerHost('http://192.168.1.50:7125/')).toBe('192.168.1.50');
    expect(printerHost('https://voron.lan')).toBe('voron.lan');
  });

  it('keeps IPv6 brackets and rejects garbage', () => {
    expect(printerHost('http://[fd00::1]:7125')).toBe('[fd00::1]');
    expect(printerHost('')).toBeNull();
    expect(printerHost('not a url')).toBeNull();
  });
});

describe('normalizeManual', () => {
  it('adds a scheme and refuses other protocols', () => {
    expect(normalizeManual('printer.local:8080/kapat/')).toBe('http://printer.local:8080/kapat/');
    expect(normalizeManual(' https://p/autopa/ ')).toBe('https://p/autopa/');
    expect(normalizeManual('javascript:alert(1)')).toBeNull();
    expect(normalizeManual('ftp://p/')).toBeNull();
    expect(normalizeManual('')).toBeNull();
    expect(normalizeManual(undefined)).toBeNull();
  });
});

describe('candidates', () => {
  const ctx = { pageOrigin: 'http://printer.local:8000', printerUrl: 'http://printer.local:7125' };

  it('goes: own address, then this site, then the printer on the default port', () => {
    expect(candidates(autopa, { ...ctx, manual: 'myhost/autopa/' })).toEqual([
      'http://myhost/autopa/',
      'http://printer.local:8000/autopa/',
      'http://printer.local/autopa/',
    ]);
  });

  it('drops duplicates (page already on the default port)', () => {
    expect(candidates(kapat, { pageOrigin: 'http://printer.local', printerUrl: 'http://printer.local:7125' })).toEqual([
      'http://printer.local/kapat/',
    ]);
  });

  it('follows the scheme of the page', () => {
    expect(candidates(kapat, { pageOrigin: 'https://tessera.example:8443', printerUrl: 'http://10.0.0.5:7125' })).toEqual([
      'https://tessera.example:8443/kapat/',
      'https://10.0.0.5/kapat/',
    ]);
  });

  it('works in a document without an origin and with a bad printer url', () => {
    expect(candidates(kapat, { pageOrigin: 'null', printerUrl: 'http://printer:7125' })).toEqual(['http://printer/kapat/']);
    expect(candidates(kapat, { pageOrigin: 'http://a:1', printerUrl: '' })).toEqual(['http://a:1/kapat/']);
  });

  it('every provider path is a rooted folder', () => {
    for (const p of PROVIDERS) expect(p.path).toMatch(/^\/[a-z]+\/$/);
  });
});

describe('isMixedContent', () => {
  it('is only http inside https', () => {
    expect(isMixedContent('http://p/autopa/', 'https:')).toBe(true);
    expect(isMixedContent('https://p/autopa/', 'https:')).toBe(false);
    expect(isMixedContent('http://p/autopa/', 'http:')).toBe(false);
  });
});

const res = (ok: boolean, body = ''): Awaited<ReturnType<FetchLike>> => ({ ok, text: async () => body });

describe('probe', () => {
  const origin = 'http://tessera:8000';

  it('same origin: a page different from the site root is a provider', async () => {
    const fetchFn: FetchLike = async (u) =>
      u.endsWith('/autopa/') ? res(true, '<title>autopa</title>') : res(true, '<title>Tessera</title>');
    expect(await probe('http://tessera:8000/autopa/', origin, 1000, fetchFn)).toBe(true);
  });

  it('same origin: the SPA fallback (index.html for any path) is not a provider', async () => {
    const fetchFn: FetchLike = async () => res(true, '<title>Tessera</title>');
    expect(await probe('http://tessera:8000/autopa/', origin, 1000, fetchFn)).toBe(false);
  });

  it('same origin: 404 and network errors', async () => {
    expect(await probe('http://tessera:8000/autopa/', origin, 1000, async () => res(false))).toBe(false);
    expect(
      await probe('http://tessera:8000/autopa/', origin, 1000, async () => {
        throw new TypeError('network');
      }),
    ).toBe(false);
  });

  it('other origin: reachability through no-cors', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => res(false));
    expect(await probe('http://printer/autopa/', origin, 1000, fetchFn)).toBe(true);
    expect(fetchFn.mock.calls[0]![1]).toMatchObject({ mode: 'no-cors' });
    expect(
      await probe('http://printer/autopa/', origin, 1000, async () => {
        throw new TypeError('refused');
      }),
    ).toBe(false);
  });

  it('never tries a mixed-content address', async () => {
    const fetchFn = vi.fn<FetchLike>(async () => res(true, 'x'));
    expect(await probe('http://printer/autopa/', 'https://tessera', 1000, fetchFn)).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('gives up after the timeout', async () => {
    const fetchFn: FetchLike = (_u, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    expect(await probe('http://printer/autopa/', origin, 10, fetchFn)).toBe(false);
  });
});

describe('resolveUrl', () => {
  const ctx = { pageOrigin: 'http://tessera:8000', printerUrl: 'http://printer:7125' };

  it('takes the first address that answers', async () => {
    const seen: string[] = [];
    const r = await resolveUrl(autopa, ctx, async (u) => {
      seen.push(u);
      return u === 'http://printer/autopa/';
    });
    expect(r).toEqual({
      url: 'http://printer/autopa/',
      manual: false,
      tried: ['http://tessera:8000/autopa/', 'http://printer/autopa/'],
    });
    expect(seen).toEqual(r.tried);
  });

  it('trusts the address the user typed and does not probe', async () => {
    const probeFn = vi.fn(async () => false);
    const r = await resolveUrl(autopa, { ...ctx, manual: 'http://x:9/a/' }, probeFn);
    expect(r).toEqual({ url: 'http://x:9/a/', manual: true, tried: ['http://x:9/a/'] });
    expect(probeFn).not.toHaveBeenCalled();
  });

  it('reports what it tried when nothing answers', async () => {
    const r = await resolveUrl(kapat, ctx, async () => false);
    expect(r.url).toBeNull();
    expect(r.tried).toEqual(['http://tessera:8000/kapat/', 'http://printer/kapat/']);
  });
});
