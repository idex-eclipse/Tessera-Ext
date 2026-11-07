/** Unit tests of the pure moonraker-obico.cfg helpers (core/config.ts). */
import { describe, expect, it } from 'vitest';

import { isCloudUrl, logFileRef, obicoPrinterUrl, parseIni, readObicoConfig, tesseraPort, tunnelSnippet } from '../core/config';

// Shaped like moonraker-obico.cfg.sample after linking to a self-hosted server.
const SAMPLE = `
[server]
url = http://192.168.1.20:3334/
auth_token = 0123456789abcdef
sentry_opt = out

[moonraker]
host = 127.0.0.1
port = 7125

# comment
[logging]
path = /home/pi/printer_data/logs/moonraker-obico.log
level = INFO

[tunnel]
; dest_host = 127.0.0.1
dest_port = 8000
dest_is_ssl = False
`;

describe('parseIni', () => {
  it('reads sections and keys, skips comments, lower-cases names', () => {
    const ini = parseIni('[Server]\nURL: https://x\n# a = b\n;c=d\n');
    expect(ini).toEqual({ server: { url: 'https://x' } });
  });

  it('ignores keys before the first section and lines without a separator', () => {
    expect(parseIni('a = 1\n[s]\nnoise\nb=2')).toEqual({ s: { b: '2' } });
  });
});

describe('readObicoConfig', () => {
  it('reads a linked self-hosted config', () => {
    const cfg = readObicoConfig(parseIni(SAMPLE));
    expect(cfg).toEqual({
      serverUrl: 'http://192.168.1.20:3334',
      isCloud: false,
      hasToken: true,
      logPath: '/home/pi/printer_data/logs/moonraker-obico.log',
      tunnel: { host: '127.0.0.1', port: 8000, ssl: false },
    });
  });

  it('uses the agent defaults for missing keys', () => {
    const cfg = readObicoConfig(parseIni('[server]\nauth_token =\n'));
    expect(cfg.serverUrl).toBe('https://app.obico.io');
    expect(cfg.isCloud).toBe(true);
    expect(cfg.hasToken).toBe(false);
    expect(cfg.tunnel).toEqual({ host: '127.0.0.1', port: 80, ssl: false });
  });

  it('reads dest_is_ssl like configparser and falls back on junk', () => {
    expect(readObicoConfig(parseIni('[tunnel]\ndest_is_ssl = yes')).tunnel.ssl).toBe(true);
    expect(readObicoConfig(parseIni('[tunnel]\ndest_is_ssl = maybe\ndest_port = x')).tunnel).toEqual({
      host: '127.0.0.1',
      port: 80,
      ssl: false,
    });
  });
});

describe('helpers', () => {
  it('recognises Obico Cloud', () => {
    expect(isCloudUrl('https://app.obico.io')).toBe(true);
    expect(isCloudUrl('http://obico.local:3334')).toBe(false);
    expect(isCloudUrl('not a url')).toBe(false);
  });

  it('links to the printer page or the printer list', () => {
    expect(obicoPrinterUrl('https://app.obico.io', 42)).toBe('https://app.obico.io/printers/42/control/');
    expect(obicoPrinterUrl('https://app.obico.io', null)).toBe('https://app.obico.io/printers/');
  });

  it('maps log paths to Moonraker roots', () => {
    expect(logFileRef('')).toEqual({ root: 'logs', path: 'moonraker-obico.log' });
    expect(logFileRef('/home/pi/printer_data/logs/moonraker-obico.log')).toEqual({ root: 'logs', path: 'moonraker-obico.log' });
    expect(logFileRef('/home/pi/printer_2_data/config/obico/agent.log')).toEqual({ root: 'config', path: 'obico/agent.log' });
    expect(logFileRef('/var/log/moonraker-obico.log')).toBeNull();
  });

  it('takes Tessera port from an HTTP page only', () => {
    expect(tesseraPort({ protocol: 'http:', port: '8000' })).toBe(8000);
    expect(tesseraPort({ protocol: 'http:', port: '' })).toBe(80);
    expect(tesseraPort({ protocol: 'https:', port: '8443' })).toBeNull();
  });

  it('builds a [tunnel] snippet the agent can parse back', () => {
    expect(readObicoConfig(parseIni(tunnelSnippet(8000))).tunnel).toEqual({ host: '127.0.0.1', port: 8000, ssl: false });
  });
});
