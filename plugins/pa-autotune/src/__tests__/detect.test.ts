import { describe, expect, it, vi } from 'vitest';

import { detectFromHelp, detectFromObjects, detectProviders } from '../detect';
import type { MoonrakerProxyHandle } from '../sdk';

function handle(responses: Record<string, unknown>): MoonrakerProxyHandle {
  return {
    request: vi.fn(async (method: string) => {
      const r = responses[method];
      if (r instanceof Error) throw r;
      return r;
    }),
  } as unknown as MoonrakerProxyHandle;
}

describe('detectFromHelp', () => {
  it('finds a provider by its command, case-insensitively', () => {
    expect(detectFromHelp({ AUTOPA_SWEEP: 'x', G28: 'y' })).toEqual(['autopa']);
    expect(detectFromHelp({ kapat_sweep: 'x' })).toEqual(['kapat']);
  });

  it('lists both in table order and none for an unrelated printer', () => {
    expect(detectFromHelp({ KAPAT_SWEEP: '', AUTOPA_SWEEP: '' })).toEqual(['autopa', 'kapat']);
    expect(detectFromHelp({ G28: '', PA_CALIBRATE: '' })).toEqual([]);
    expect(detectFromHelp(null)).toEqual([]);
  });

  it('does not take other commands of a provider for installation', () => {
    expect(detectFromHelp({ AUTOPA_LIST: '', KAPAT_APPLY: '' })).toEqual([]);
  });
});

describe('detectFromObjects', () => {
  it('finds provider objects and any load cell section', () => {
    expect(detectFromObjects(['toolhead', 'autopa', 'load_cell'])).toEqual({ installed: ['autopa'], hasLoadCell: true });
    expect(detectFromObjects(['kapat', 'load_cell_probe'])).toEqual({ installed: ['kapat'], hasLoadCell: true });
    expect(detectFromObjects(['load_cell foo']).hasLoadCell).toBe(true);
  });

  it('is not fooled by similar names', () => {
    expect(detectFromObjects(['load_cell_sensor_x', 'autopa_extra'])).toEqual({ installed: [], hasLoadCell: false });
    expect(detectFromObjects(undefined)).toEqual({ installed: [], hasLoadCell: false });
  });
});

describe('detectProviders', () => {
  it('combines gcode/help and objects/list', async () => {
    const d = await detectProviders(
      handle({ 'printer.gcode.help': { AUTOPA_SWEEP: '' }, 'printer.objects.list': { objects: ['kapat', 'load_cell'] } }),
    );
    expect(d).toEqual({ installed: ['autopa', 'kapat'], hasLoadCell: true, unknown: false });
  });

  it('survives one failing query', async () => {
    const d = await detectProviders(
      handle({ 'printer.gcode.help': new Error('klippy not ready'), 'printer.objects.list': { objects: ['autopa'] } }),
    );
    expect(d).toEqual({ installed: ['autopa'], hasLoadCell: false, unknown: false });
  });

  it('reports "unknown", not "nothing installed", when both fail', async () => {
    const d = await detectProviders(handle({ 'printer.gcode.help': new Error('x'), 'printer.objects.list': new Error('y') }));
    expect(d).toEqual({ installed: [], hasLoadCell: false, unknown: true });
  });
});
