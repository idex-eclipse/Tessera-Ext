import { describe, expect, it } from 'vitest';

import { pickProvider, settingUrl } from '../selection';

describe('pickProvider', () => {
  it('returns null without providers', () => {
    expect(pickProvider([], 'kapat')).toBeNull();
  });

  it('defaults to autopa, then to whatever is installed', () => {
    expect(pickProvider(['autopa', 'kapat'], undefined)?.id).toBe('autopa');
    expect(pickProvider(['kapat'], undefined)?.id).toBe('kapat');
  });

  it('keeps the saved choice while it is installed', () => {
    expect(pickProvider(['autopa', 'kapat'], 'kapat')?.id).toBe('kapat');
  });

  it('falls back when the saved provider is gone or the value is garbage', () => {
    expect(pickProvider(['autopa'], 'kapat')?.id).toBe('autopa');
    expect(pickProvider(['autopa', 'kapat'], 42)?.id).toBe('autopa');
    expect(pickProvider(['kapat'], 'other')?.id).toBe('kapat');
  });

  it('names the address setting by provider', () => {
    expect(settingUrl('kapat')).toBe('url.kapat');
  });
});
