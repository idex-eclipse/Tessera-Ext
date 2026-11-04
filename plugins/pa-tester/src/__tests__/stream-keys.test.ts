import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openStream, resetStreamKeys } from '../stream-keys';

describe('stream parameter names', () => {
  const variants = [{ sensor: 'x' }, { load_cell: 'x' }];

  /** A handle whose stream is rejected unless it carries one of `accepted`'s keys. */
  function fakeHandle(accepted: string) {
    const calls: Array<Record<string, unknown>> = [];
    const cancels: Array<ReturnType<typeof vi.fn>> = [];
    const klippyStream = vi.fn((_m: string, params: Record<string, unknown>, _d: unknown, onStatus?: (s: string) => void) => {
      calls.push(params);
      const cancel = vi.fn();
      cancels.push(cancel);
      queueMicrotask(() => onStatus?.(accepted in params ? 'live' : 'unavailable'));
      return cancel;
    });
    return { handle: { klippyStream } as never, calls, cancels };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(() => resetStreamKeys());

  it('stays on the documented key when Klipper accepts it', async () => {
    const f = fakeHandle('sensor');
    const status = vi.fn();
    openStream(f.handle, 'm', variants, () => {}, status);
    await tick();
    expect(f.calls).toEqual([{ sensor: 'x' }]);
    expect(status.mock.calls.map((c) => c[0])).toEqual(['live']);
  });

  it('falls back to the older key without reporting the rejection', async () => {
    const f = fakeHandle('load_cell');
    const status = vi.fn();
    const stop = openStream(f.handle, 'm', variants, () => {}, status);
    await tick();
    expect(f.calls).toEqual([{ sensor: 'x' }, { load_cell: 'x' }]);
    expect(status.mock.calls.map((c) => c[0])).toEqual(['live']);
    stop();
    f.cancels.forEach((c) => expect(c).toHaveBeenCalled());
  });

  it('remembers the key that worked', async () => {
    const f = fakeHandle('load_cell');
    openStream(f.handle, 'm', variants, () => {}, () => {});
    await tick();
    const g = fakeHandle('load_cell');
    openStream(g.handle, 'm', variants, () => {}, () => {});
    await tick();
    expect(g.calls).toEqual([{ load_cell: 'x' }]);
  });

  it('reports unavailable once when every key is rejected', async () => {
    const f = fakeHandle('none');
    const status = vi.fn();
    openStream(f.handle, 'm', variants, () => {}, status);
    await tick();
    expect(f.calls).toHaveLength(2);
    expect(status.mock.calls.map((c) => c[0])).toEqual(['unavailable']);
  });

  it('does not open the next key after a stop', async () => {
    const f = fakeHandle('load_cell');
    openStream(f.handle, 'm', variants, () => {}, () => {})();
    await tick();
    expect(f.calls).toEqual([{ sensor: 'x' }]);
  });
});
