import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { gunzip, gzip, tarCreate, tarExtract } from '../core/archive';
import { generateDatasets } from '../core/engine';
import { buildCsv, csvColumnHeader } from '../core/export-csv';
import { captureDuration, exportMotanArchive, importMotanFiles, parseMotanLog, serializeMotanLog } from '../core/motan-log';
import { MotanError, type CaptureData } from '../core/types';
import { DiagStore } from '../state';
import { loadMotanLog } from './helpers/motan-log';

const fixtureDir = (name: string) => fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));
const cartesian = loadMotanLog(fixtureDir('cartesian') + 'log');

const dec = new TextDecoder();
const enc = new TextEncoder();

describe('gzip and tar', () => {
  it('round-trips data through gzip, also a large one', async () => {
    const data = new Uint8Array(3_000_000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) % 251;
    const back = await gunzip(await gzip(data));
    // compared bytewise by Buffer: a deep equality over 3 million elements is very slow
    expect(Buffer.compare(back, data)).toBe(0);
  });

  it('makes gzip that Node (and so zlib, as motan reads it) accepts', async () => {
    const { gunzipSync } = await import('node:zlib');
    const out = gunzipSync(await gzip(enc.encode('hello\x03world\x03')));
    expect(dec.decode(out)).toBe('hello\x03world\x03');
  });

  it('keeps the decodable part of a truncated gzip when asked to', async () => {
    const text = 'x'.repeat(200_000);
    const gz = await gzip(enc.encode(text));
    const cut = gz.slice(0, gz.length - 8); // trailer gone, like a killed writer
    await expect(gunzip(cut)).rejects.toThrow();
    const part = await gunzip(cut, true);
    expect(part.length).toBeGreaterThan(0);
    expect(dec.decode(part)).toBe(text.slice(0, part.length));
  });

  it('writes a valid ustar archive and reads it back', () => {
    const a = enc.encode('a'.repeat(700));
    const b = new Uint8Array(0);
    const tar = tarCreate(
      [
        { name: 'dump.json.gz', data: a },
        { name: 'empty', data: b },
      ],
      1_700_000_000,
    );
    expect(tar.length % 512).toBe(0);
    // checksum of the first header, as tar tools verify it
    const header = tar.slice(0, 512);
    const stored = parseInt(dec.decode(header.slice(148, 154)), 8);
    header.fill(0x20, 148, 156);
    expect(header.reduce((n, v) => n + v, 0)).toBe(stored);
    expect(dec.decode(header.slice(257, 262))).toBe('ustar');
    const files = tarExtract(tar);
    expect(files.map((f) => f.name)).toEqual(['dump.json.gz', 'empty']);
    expect(files[0]!.data).toEqual(a);
    expect(files[1]!.data.length).toBe(0);
  });

  it('refuses a truncated tar', () => {
    const tar = tarCreate([{ name: 'a', data: enc.encode('x'.repeat(2000)) }]);
    expect(() => tarExtract(tar.slice(0, 1000))).toThrow(/truncated/);
  });
});

describe('motan log files', () => {
  it('writes what it reads: the capture survives a round trip', () => {
    const back = parseMotanLog(serializeMotanLog(cartesian));
    expect(back.initialStatus).toEqual(cartesian.initialStatus);
    expect([...back.subscriptions].sort()).toEqual([...cartesian.subscriptions].sort());
    expect([...back.streams.keys()].sort()).toEqual([...cartesian.streams.keys()].sort());
    for (const [id, list] of cartesian.streams) expect(back.streams.get(id), id).toEqual(list);
  });

  it('writes the framing of data_logger.py: ETX-terminated JSON, data as {q, params}', () => {
    const { json, index } = serializeMotanLog(cartesian);
    const messages = dec.decode(json).split('\x03').filter(Boolean).map((m) => JSON.parse(m));
    expect(messages[0]).toEqual({ id: 'info', result: { state: 'ready' } });
    expect(messages.some((m) => m.id === 'status' && m.result.status.toolhead)).toBe(true);
    const data = messages.filter((m) => typeof m.q === 'string');
    expect(data.length).toBe([...cartesian.streams.values()].reduce((n, l) => n + l.length, 0));
    expect(data.every((m) => 'params' in m)).toBe(true);
    // the index: initial status first
    const first = JSON.parse(dec.decode(index).split('\x03')[0]!);
    expect(first.status.toolhead.estimated_print_time).toBe(100);
    expect(Object.keys(first.subscriptions)).toContain('accelerometer:hotend');
  });

  it('interleaves the streams instead of writing them one after another', () => {
    const { json } = serializeMotanLog(cartesian);
    const qs = dec.decode(json).split('\x03').filter(Boolean).map((m) => JSON.parse(m).q).filter(Boolean) as string[];
    const changes = qs.filter((q, i) => i > 0 && q !== qs[i - 1]).length;
    expect(changes).toBeGreaterThan(cartesian.streams.size * 2);
  });

  it('gives the same numbers when the exported archive is opened again (motan golden cases)', async () => {
    const bytes = await exportMotanArchive(cartesian);
    const back = await importMotanFiles([{ name: 'x.tar.gz', data: bytes }]);
    const meta = JSON.parse(readFileSync(fixtureDir('cartesian') + 'cases.json', 'utf8')) as {
      cases: Array<{ id: string; columns: string[]; skip: number; duration: number; segmentTime: number }>;
    };
    for (const c of meta.cases.filter((x) => ['trapq', 'stepq', 'kin', 'accelerometer', 'analyzers', 'skip'].includes(x.id))) {
      const opts = { segmentTime: c.segmentTime, skip: c.skip, duration: c.duration };
      const a = await generateDatasets(cartesian, c.columns, opts);
      const b = await generateDatasets(back, c.columns, opts);
      for (const col of c.columns) expect(Array.from(b.series.get(col)!), `${c.id}: ${col}`).toEqual(Array.from(a.series.get(col)!));
    }
  });

  it('puts dump.json.gz and dump.index.gz in the archive, each a valid gzip', async () => {
    const tar = await gunzip(await exportMotanArchive(cartesian, 'dump'));
    const files = tarExtract(tar);
    expect(files.map((f) => f.name)).toEqual(['dump.json.gz', 'dump.index.gz']);
    for (const f of files) expect(f.data[0]).toBe(0x1f); // gzip magic
    const { gunzipSync } = await import('node:zlib');
    expect(dec.decode(gunzipSync(files[1]!.data)).startsWith('{"status"')).toBe(true);
  });
});

describe('opening files', () => {
  it('opens the two loose files of a log, as data_logger.py writes them', async () => {
    const dir = fixtureDir('cartesian');
    const files = ['log.json.gz', 'log.index.gz'].map((name) => ({ name, data: new Uint8Array(readFileSync(dir + name)) }));
    const capture = await importMotanFiles(files);
    expect(capture.streams.get('trapq:toolhead')!.length).toBe(cartesian.streams.get('trapq:toolhead')!.length);
    // in any order
    expect((await importMotanFiles([...files].reverse())).subscriptions).toEqual(capture.subscriptions);
  });

  it('reads the real log of a printer that was written by Klipper itself', async () => {
    const dir = new URL('../../local/', import.meta.url);
    let files;
    try {
      files = ['log.json.gz', 'log.index.gz'].map((name) => ({ name, data: new Uint8Array(readFileSync(new URL(name, dir))) }));
    } catch {
      return; // the git-ignored real capture is not here (see real-log.test.ts)
    }
    const capture = await importMotanFiles(files);
    expect(capture.subscriptions.size).toBeGreaterThan(0);
    expect(captureDuration(capture)).toBeGreaterThan(30);
    // and it goes out again unchanged in substance
    const again = await importMotanFiles([{ name: 'a.tgz', data: await exportMotanArchive(capture) }]);
    expect(again.streams.get('loadcell:load_cell_probe')).toEqual(capture.streams.get('loadcell:load_cell_probe'));
  });

  it('explains what is missing', async () => {
    const dir = fixtureDir('cartesian');
    const one = [{ name: 'log.json.gz', data: new Uint8Array(readFileSync(dir + 'log.json.gz')) }];
    await expect(importMotanFiles(one)).rejects.toThrow(MotanError);
    await expect(importMotanFiles(one)).rejects.toThrow(/both/);
    await expect(importMotanFiles([{ name: 'broken.tar.gz', data: enc.encode('not gzip') }])).rejects.toThrow(/not a valid archive/);
    await expect(importMotanFiles([])).rejects.toThrow(/both/);
  });

  it('rejects a log that has no starting time', async () => {
    const bad: CaptureData = { ...cartesian, initialStatus: { toolhead: {} } };
    await expect(importMotanFiles([{ name: 'x.tar.gz', data: await exportMotanArchive(bad) }])).rejects.toThrow(/estimated_print_time/);
  });

  it('skips a message cut short by a killed logger', () => {
    const { json, index } = serializeMotanLog(cartesian);
    const text = dec.decode(json);
    const cut = enc.encode(text.slice(0, text.length - 50));
    const back = parseMotanLog({ json: cut, index });
    const full = [...cartesian.streams.values()].reduce((n, l) => n + l.length, 0);
    const got = [...back.streams.values()].reduce((n, l) => n + l.length, 0);
    expect(got).toBeLessThan(full);
    expect(got).toBeGreaterThan(full - 3);
  });

  it('measures the duration from the status updates', () => {
    expect(captureDuration(cartesian)).toBeGreaterThan(1.5);
    expect(captureDuration({ ...cartesian, streams: new Map() })).toBe(0);
  });
});

describe('CSV', () => {
  it('has the layout of data_export.py and the same numbers', async () => {
    const dir = fixtureDir('cartesian');
    const meta = JSON.parse(readFileSync(dir + 'cases.json', 'utf8')) as {
      cases: Array<{ id: string; columns: string[]; skip: number; duration: number; segmentTime: number; csv: string }>;
    };
    const c = meta.cases.find((x) => x.id === 'analyzers')!;
    const out = await generateDatasets(cartesian, c.columns, { segmentTime: c.segmentTime, skip: c.skip, duration: c.duration });
    const mine = buildCsv(out, c.columns).split('\n').filter(Boolean);
    const theirs = readFileSync(dir + c.csv, 'utf8').split(/\r*\n/).filter(Boolean);
    expect(mine.length).toBe(theirs.length);
    expect(mine[0]).toBe(theirs[0]);
    for (const r of [1, 100, 500, mine.length - 1]) {
      const a = mine[r]!.split(',').map(Number);
      const b = theirs[r]!.split(',').map(Number);
      a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(1e-9 * Math.max(1, Math.abs(b[i]!))));
    }
  });

  it('writes a gap as an empty cell and quotes a header with a comma', () => {
    const data = {
      times: Float64Array.of(0.1, 0.2),
      series: new Map([['a', Float64Array.of(1, Number.NaN)]]),
      labels: new Map([['a', { label: 'x, y', units: 'U\n(mm)' }]]),
    };
    expect(csvColumnHeader(data.labels.get('a')!)).toBe('x, y (mm)');
    expect(buildCsv(data, ['a'])).toBe('Time (s),"x, y (mm)"\n0.1,1\n0.2,\n');
  });
});

describe('the store', () => {
  const store = () =>
    new DiagStore(() => {
      throw new Error('no printer in this test');
    });

  it('opens a saved capture, sets up its window and first layout, and exports both ways', async () => {
    const s = store();
    const bytes = await exportMotanArchive(cartesian);
    await s.openFiles([{ name: 'saved.tar.gz', data: bytes }]);
    expect(s.state.openError).toBe('');
    expect(s.state.capture).not.toBeNull();
    expect(s.state.snapshot?.state).toBe('stopped');
    expect(s.state.captureSeconds).toBeGreaterThan(1.5);
    expect(s.state.graphs.rows.length).toBeGreaterThan(0);
    expect(s.state.preset).not.toBe('');

    // the first layout is drawn without a click
    for (let i = 0; i < 100 && !s.state.computed; i++) await new Promise((r) => setTimeout(r, 20));
    expect(s.state.computed).not.toBeNull();

    const csv = s.exportCsv()!;
    expect(csv.split('\n')[0]).toMatch(/^Time \(s\),/);
    const blob = (await s.exportMotan('dump'))!;
    expect(blob.type).toBe('application/gzip');
    expect(blob.size).toBeGreaterThan(1000);
  });

  it('reports a file it cannot open and keeps what it had', async () => {
    const s = store();
    await s.openFiles([{ name: 'x.tar.gz', data: enc.encode('nope') }]);
    expect(s.state.openError).toMatch(/not a valid archive/);
    expect(s.state.capture).toBeNull();
    expect(s.exportCsv()).toBeNull();
    expect(await s.exportMotan()).toBeNull();
  });
});
