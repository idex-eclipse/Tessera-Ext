import { describe, expect, it, vi } from 'vitest';

import { DiagStore } from '../state';
import type { MoonrakerProxyHandle } from '../sdk';

/** A delayed discovery for the old printer must not replace the new printer's sources. */
describe('printer-bound diagnostic store', () => {
  it('routes discovery by bound ID and discards a late result after switching printers', async () => {
    let finishFirst: ((value: { state: string }) => void) | undefined;
    const firstInfo = new Promise<{ state: string }>((resolve) => { finishFirst = resolve; });
    const handleFor = vi.fn((printerId: string) => ({
      klippyRequest: vi.fn((method: string) => {
        if (method === 'info') return printerId === 'p1' ? firstInfo : Promise.resolve({ state: 'ready' });
        return Promise.resolve({ status: { motion_report: { trapq: [printerId] } } });
      }),
    } as unknown as MoonrakerProxyHandle));
    const store = new DiagStore(handleFor);

    store.bindPrinter('p1');
    const oldQuery = store.refreshSources();
    store.bindPrinter('p2');
    await store.refreshSources();
    expect(handleFor).toHaveBeenCalledWith('p1');
    expect(handleFor).toHaveBeenCalledWith('p2');
    expect(store.state.sources.map((source) => source.id)).toContain('trapq:p2');

    finishFirst!({ state: 'ready' });
    await oldQuery;
    expect(store.state.sources.map((source) => source.id)).toContain('trapq:p2');
    expect(store.state.sources.map((source) => source.id)).not.toContain('trapq:p1');
  });
});
