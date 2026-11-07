/** Tests of the per-printer model (core/state.ts) against a fake Moonraker handle. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchLogTail, findObicoService, linkInfo, LOG_TAIL_BYTES, ObicoState, serviceFromSystemInfo } from '../core/state';
import type { MoonrakerProxyHandle } from '../sdk';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A Moonraker handle answering from a table; `subscribe` hands its callback to the test. */
function fakeHandle(responses: Record<string, () => unknown>) {
  let push: ((delta: unknown) => void) | null = null;
  const notify = new Map<string, () => void>();
  const handle = {
    httpBaseUrl: 'http://printer',
    authToken: 'tok',
    request: vi.fn(async (method: string) => {
      const r = responses[method];
      if (!r) throw new Error(`no ${method}`);
      return r();
    }),
    subscribe: vi.fn((_o: unknown, cb: (d: unknown) => void) => {
      push = cb;
      return () => (push = null);
    }),
    onNotify: vi.fn((event: string, cb: () => void) => {
      notify.set(event, cb);
      return () => notify.delete(event);
    }),
    onReady: vi.fn(() => () => {}),
  } as unknown as MoonrakerProxyHandle;
  return { handle, push: (d: unknown) => push?.(d), notify };
}

function mockFetch(impl: (url: string, init?: RequestInit) => Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => impl(url, init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('service lookup', () => {
  it('finds the agent service by name', () => {
    expect(findObicoService(['klipper', 'moonraker-obico'])).toBe('moonraker-obico');
    expect(findObicoService(['moonraker-obico-printer_2'])).toBe('moonraker-obico-printer_2');
    expect(findObicoService(['moonraker', 'moonraker-obicox'])).toBeNull();
  });

  it('reads the state from machine.system_info', () => {
    const reply = {
      system_info: {
        available_services: ['klipper', 'moonraker-obico'],
        service_state: { 'moonraker-obico': { active_state: 'active', sub_state: 'running' } },
      },
    };
    expect(serviceFromSystemInfo(reply)).toEqual({ name: 'moonraker-obico', active: 'active', sub: 'running' });
    expect(serviceFromSystemInfo({ system_info: { available_services: ['klipper'] } })).toBeNull();
    expect(serviceFromSystemInfo(null)).toBeNull();
  });
});

describe('linkInfo', () => {
  it('prefers the macro and falls back to the config token', () => {
    expect(linkInfo({ is_linked: false, one_time_passcode: 'ab12', one_time_passlink: 'http://x' }, null)).toEqual({
      linked: false,
      passcode: 'ab12',
      passlink: 'http://x',
    });
    const cfg = { serverUrl: '', isCloud: false, hasToken: true, logPath: '', tunnel: { host: '', port: 80, ssl: false } };
    expect(linkInfo(null, cfg).linked).toBe(true);
    expect(linkInfo(null, null).linked).toBeNull();
  });
});

describe('ObicoState', () => {
  it('gathers config, service, DB id and live macro values', async () => {
    const fetchFn = mockFetch(() => new Response('[server]\nurl = http://obico:3334\nauth_token =\n'));
    const { handle, push } = fakeHandle({
      'machine.system_info': () => ({
        system_info: { available_services: ['moonraker-obico'], service_state: { 'moonraker-obico': { active_state: 'active', sub_state: 'running' } } },
      }),
      'printer.objects.list': () => ({ objects: ['gcode_macro OBICO_LINK_STATUS', 'gcode_macro _OBICO_RELINK'] }),
      'server.database.get_item': () => ({ value: 7 }),
      'machine.services.restart': () => 'ok',
      'printer.gcode.script': () => 'ok',
    });
    const state = new ObicoState(handle);
    await flush();

    const s = state.snapshot;
    expect(s.loading).toBe(false);
    expect(s.installed).toBe(true);
    expect(s.config?.serverUrl).toBe('http://obico:3334');
    expect(s.printerId).toBe(7);
    expect(s.service?.name).toBe('moonraker-obico');
    expect(s.canRelink).toBe(true);
    // Before the macro answers, the empty token in the config says "not linked".
    expect(s.link.linked).toBe(false);
    expect(fetchFn.mock.calls[0]![0]).toBe('http://printer/server/files/config/moonraker-obico.cfg');
    expect((fetchFn.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer tok');

    push({ 'gcode_macro OBICO_LINK_STATUS': { is_linked: false, one_time_passcode: 'CODE12' } });
    expect(state.snapshot.link.passcode).toBe('CODE12');
    push({ 'gcode_macro OBICO_LINK_STATUS': { is_linked: true } });
    expect(state.snapshot.link).toEqual({ linked: true, passcode: 'CODE12', passlink: '' });

    await state.restartService();
    expect(handle.request).toHaveBeenCalledWith('machine.services.restart', { service: 'moonraker-obico' });
    await state.relink();
    expect(handle.request).toHaveBeenCalledWith('printer.gcode.script', { script: '_OBICO_RELINK' });
    state.dispose();
  });

  it('reports "not installed" when every source is missing', async () => {
    mockFetch(() => new Response('', { status: 404 }));
    const { handle } = fakeHandle({
      'machine.system_info': () => ({ system_info: { available_services: ['klipper'] } }),
      'printer.objects.list': () => ({ objects: [] }),
    });
    const state = new ObicoState(handle);
    await flush();
    expect(state.snapshot).toMatchObject({ loading: false, installed: false, config: null, service: null, printerId: null });
    expect(handle.subscribe).not.toHaveBeenCalled();
    state.dispose();
  });

  it('refreshes the service on notify_service_state_changed', async () => {
    mockFetch(() => new Response('', { status: 404 }));
    let active = 'active';
    const { handle, notify } = fakeHandle({
      'machine.system_info': () => ({ system_info: { service_state: { 'moonraker-obico': { active_state: active, sub_state: 'x' } } } }),
      'printer.objects.list': () => ({ objects: [] }),
    });
    const state = new ObicoState(handle);
    await flush();
    active = 'failed';
    notify.get('notify_service_state_changed')!();
    await flush();
    expect(state.snapshot.service?.active).toBe('failed');
    state.dispose();
    expect(notify.size).toBe(0);
  });
});

describe('fetchLogTail', () => {
  const handle = { httpBaseUrl: 'http://printer', authToken: null } as unknown as MoonrakerProxyHandle;

  it('asks for the end of the file and drops the cut first line', async () => {
    const fetchFn = mockFetch(() => new Response('partial\nline 1\nline 2\n', { status: 206, headers: { 'Content-Range': 'bytes 100-122/123' } }));
    expect(await fetchLogTail(handle, { root: 'logs', path: 'moonraker-obico.log' })).toBe('line 1\nline 2\n');
    expect(fetchFn.mock.calls[0]![0]).toBe('http://printer/server/files/logs/moonraker-obico.log');
    expect((fetchFn.mock.calls[0]![1]!.headers as Record<string, string>).Range).toBe(`bytes=-${LOG_TAIL_BYTES}`);
  });

  it('keeps a short file whole and cuts a long one when Range is ignored', async () => {
    mockFetch(() => new Response('a\nb\n', { status: 206, headers: { 'Content-Range': 'bytes 0-3/4' } }));
    expect(await fetchLogTail(handle, { root: 'logs', path: 'x.log' })).toBe('a\nb\n');
    mockFetch(() => new Response('x'.repeat(LOG_TAIL_BYTES) + '\nlast\n'));
    expect(await fetchLogTail(handle, { root: 'logs', path: 'x.log' })).toBe('last\n');
  });

  it('tells a missing file from an empty one', async () => {
    mockFetch(() => new Response('', { status: 404 }));
    expect(await fetchLogTail(handle, { root: 'logs', path: 'x.log' })).toBeNull();
    mockFetch(() => new Response('', { status: 416 }));
    expect(await fetchLogTail(handle, { root: 'logs', path: 'x.log' })).toBe('');
  });
});
