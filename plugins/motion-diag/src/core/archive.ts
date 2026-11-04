/**
 * gzip and tar, just enough for motan log archives, on the browser's own streams
 * (CompressionStream / DecompressionStream) so nothing needs to be bundled.
 */

async function collect(stream: ReadableStream<Uint8Array>, tolerateTruncation: boolean): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } catch (e) {
    // A log whose writer was killed has no gzip trailer: keep what was decoded so far.
    if (!tolerateTruncation || chunks.length === 0) throw e;
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

/** CompressionStream and DecompressionStream, whose chunk types the DOM typings spell differently. */
type Transform = { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> };

async function pipe(data: Uint8Array, transform: Transform, tolerate: boolean): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  // Feed and read at the same time: the transform applies back-pressure.
  const written = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  written.catch(() => {});
  const out = await collect(transform.readable, tolerate);
  await written.catch((e) => {
    if (!tolerate) throw e;
  });
  return out;
}

export function gzip(data: Uint8Array): Promise<Uint8Array> {
  return pipe(data, new CompressionStream('gzip'), false);
}

/** `tolerateTruncation`: return the part that could be decoded when the stream ends early. */
export function gunzip(data: Uint8Array, tolerateTruncation = false): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream('gzip'), tolerateTruncation);
}

export interface TarEntry {
  name: string;
  data: Uint8Array;
}

const BLOCK = 512;
const enc = new TextEncoder();
const dec = new TextDecoder();

function putString(block: Uint8Array, offset: number, text: string, length: number): void {
  block.set(enc.encode(text).subarray(0, length), offset);
}

function putOctal(block: Uint8Array, offset: number, value: number, length: number): void {
  // Octal digits, zero padded, then a NUL (the classic header field format).
  putString(block, offset, value.toString(8).padStart(length - 1, '0'), length - 1);
}

/** A ustar archive of regular files (names up to 100 bytes). */
export function tarCreate(entries: readonly TarEntry[], mtime = Math.floor(Date.now() / 1000)): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    if (enc.encode(entry.name).length > 100) throw new Error(`tar: name too long: ${entry.name}`);
    const header = new Uint8Array(BLOCK);
    putString(header, 0, entry.name, 100);
    putOctal(header, 100, 0o644, 8);
    putOctal(header, 108, 0, 8);
    putOctal(header, 116, 0, 8);
    putOctal(header, 124, entry.data.length, 12);
    putOctal(header, 136, mtime, 12);
    header.fill(0x20, 148, 156); // the checksum is computed with this field as spaces
    header[156] = 0x30; // '0': regular file
    putString(header, 257, 'ustar', 6);
    putString(header, 263, '00', 2);
    let sum = 0;
    for (const b of header) sum += b;
    putString(header, 148, sum.toString(8).padStart(6, '0'), 6);
    header[154] = 0;
    header[155] = 0x20;
    parts.push(header, entry.data, new Uint8Array((BLOCK - (entry.data.length % BLOCK)) % BLOCK));
  }
  parts.push(new Uint8Array(BLOCK * 2)); // end of archive
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** The regular files of a tar archive. Directories and special entries are skipped. */
export function tarExtract(tar: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let pos = 0;
  while (pos + BLOCK <= tar.length) {
    const header = tar.subarray(pos, pos + BLOCK);
    if (header.every((b) => b === 0)) break;
    const text = (from: number, len: number): string => dec.decode(header.subarray(from, from + len)).replace(/\0.*$/s, '');
    const size = parseInt(text(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 0x30);
    const prefix = text(345, 155);
    const name = prefix ? `${prefix}/${text(0, 100)}` : text(0, 100);
    pos += BLOCK;
    if (!Number.isFinite(size) || pos + size > tar.length) throw new Error('tar: the archive is truncated');
    if (type === '0' || type === '\0') out.push({ name, data: tar.slice(pos, pos + size) });
    pos += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}
