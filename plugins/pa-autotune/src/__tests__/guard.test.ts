import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setApi } from '../api-ref';
import { guardPaAutotune } from '../guard';
import type { PluginApi } from '../sdk';

let printState: string | Error = 'standby';
const request = vi.fn(async () => {
  if (printState instanceof Error) throw printState;
  return { status: { print_stats: { state: printState } } };
});
const api = { moonrakerFor: () => ({ request }) } as unknown as PluginApi;

const run = (script: string, method = 'printer.gcode.script') =>
  guardPaAutotune({ method, params: { script }, targetPrinterId: 'p1' }, 't', { targetPrinterId: 'p1' });

beforeEach(() => {
  printState = 'standby';
  request.mockClear();
  setApi(api);
});

describe('guardPaAutotune', () => {
  it('denies the sweep commands while printing or paused', async () => {
    for (const cmd of ['AUTOPA_SWEEP MATERIAL=PLA', 'autopa_decay', 'KAPAT_SWEEP TARGET_TEMP=220', 'G28\nKAPAT_SWEEP']) {
      printState = 'printing';
      expect(await run(cmd), cmd).toEqual({ action: 'deny', reasonKey: 'paautotune.guard.printing' });
    }
    printState = 'paused';
    expect(await run('AUTOPA_SWEEP')).toEqual({ action: 'deny', reasonKey: 'paautotune.guard.printing' });
  });

  it('allows them when idle', async () => {
    for (const s of ['standby', 'complete', 'cancelled', 'error']) {
      printState = s;
      expect(await run('KAPAT_SWEEP'), s).toEqual({ action: 'allow' });
    }
  });

  it('ignores other commands without asking the printer', async () => {
    printState = 'printing';
    expect(await run('G28')).toEqual({ action: 'allow' });
    expect(await run('AUTOPA_LIST')).toEqual({ action: 'allow' });
    expect(await run('KAPAT_APPLY K=0.04')).toEqual({ action: 'allow' });
    expect(await run('; KAPAT_SWEEP in a comment')).toEqual({ action: 'allow' });
    expect(await run('KAPAT_SWEEP', 'printer.print.start')).toEqual({ action: 'allow' });
    expect(request).not.toHaveBeenCalled();
  });

  it('allows when the printer state cannot be read', async () => {
    printState = new Error('offline');
    expect(await run('AUTOPA_SWEEP')).toEqual({ action: 'allow' });
  });
});
