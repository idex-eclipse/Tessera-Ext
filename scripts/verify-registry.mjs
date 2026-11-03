// Checks that registry/ is what printers can install and what the sources build into.
//
// Usage (from the repository root):
//   node scripts/verify-registry.mjs            registry.json against the archives
//   node scripts/verify-registry.mjs --rebuild  also builds each plugin and compares
// Env: TESSERA_ROOT — Tessera checkout (default: sibling folder ../Tessera)
//
// The rules follow deploy/tessera-ext.py in Tessera: an archive refused here
// would be refused on a printer. The rebuild is the point of this repository:
// reviewers read plugins/<dir>/, printers run registry/<dir>-<version>.tar.gz,
// and this is what ties the two together.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryDir = join(repo, 'registry');
const rebuild = process.argv.includes('--rebuild');

const DIR_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
// Plugin API "MAJOR.MINOR" (Tessera plugin-sdk/src/api-level.ts). Registry entries of the
// first releases carry the integer 1, a manifest without the field is the same: "0.7".
const PLUGIN_API_RE = /^(0|[1-9]\d{0,3})\.(0|[1-9]\d{0,3})$/;
const normalizePluginApi = (v) =>
  v === undefined || v === 1 ? '0.7' : typeof v === 'string' && PLUGIN_API_RE.test(v) ? v : null;

let failures = 0;
function fail(message) {
  failures += 1;
  console.error(`FAIL: ${message}`);
  // An annotation is readable without the job log.
  if (process.env.GITHUB_ACTIONS) console.log(`::error::${message.replaceAll('%', '%25').replaceAll('\n', '%0A')}`);
}
function warn(message) {
  console.warn(`warning: ${message}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning::${message.replaceAll('%', '%25').replaceAll('\n', '%0A')}`);
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const npm = (args, cwd) => execFileSync('npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
// The archive goes by a relative name through cwd: GNU tar reads "C:\..." as host:path.
const tar = (args, cwd) => execFileSync('tar', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Relative path → sha256 of every file under dir. */
function hashTree(dir, prefix = '') {
  const files = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of hashTree(join(dir, entry.name), rel)) files.set(k, v);
    } else {
      files.set(rel, sha256(readFileSync(join(dir, entry.name))));
    }
  }
  return files;
}

function checkEntryFields(p) {
  const label = p?.id ?? JSON.stringify(p);
  for (const key of ['id', 'version', 'url', 'sha256', 'dir', 'name']) {
    if (typeof p?.[key] !== 'string' || !p[key]) {
      fail(`${label}: "${key}" must be a non-empty string`);
      return false;
    }
  }
  let ok = true;
  if (!DIR_NAME_RE.test(p.dir)) { fail(`${p.id}: invalid dir "${p.dir}"`); ok = false; }
  if (!SHA256_RE.test(p.sha256)) { fail(`${p.id}: invalid sha256 "${p.sha256}"`); ok = false; }
  if (!normalizePluginApi(p.pluginApi)) { fail(`${p.id}: invalid pluginApi ${JSON.stringify(p.pluginApi)}`); ok = false; }
  // Printers download archives next to registry.json, and only those can be reviewed here.
  if (p.url !== posix.basename(p.url) || p.url !== `${p.dir}-${p.version}.tar.gz`) {
    fail(`${p.id}: url must be "${p.dir}-${p.version}.tar.gz", got "${p.url}"`);
    ok = false;
  }
  return ok;
}

/** Unpacks an archive after the same checks a printer makes; returns the folder or null. */
function checkArchive(p) {
  const file = join(registryDir, p.url);
  if (!existsSync(file)) {
    fail(`${p.id}: ${p.url} is not in registry/`);
    return null;
  }
  const data = readFileSync(file);
  if (sha256(data) !== p.sha256) {
    fail(`${p.id}: sha256 of ${p.url} is ${sha256(data)}, registry.json says ${p.sha256}. Commit the archive and registry.json from the same "npm run pack".`);
    return null;
  }
  if (data.length > MAX_ARCHIVE_BYTES) fail(`${p.id}: ${p.url} is over the ${MAX_ARCHIVE_BYTES} bytes a printer accepts`);
  if (p.size !== undefined && p.size !== data.length) fail(`${p.id}: size in registry.json is ${p.size}, the archive has ${data.length} bytes`);

  const names = tar(['-tzf', p.url], registryDir).split('\n').filter(Boolean);
  const verbose = tar(['-tvzf', p.url], registryDir).split('\n').filter(Boolean);
  let safe = names.length === verbose.length;
  names.forEach((name, i) => {
    const type = verbose[i]?.[0];
    if (type !== '-' && type !== 'd') { fail(`${p.id}: unsupported entry (type "${type}"): ${name}`); safe = false; }
    if (name.includes('\\') || posix.isAbsolute(name) || name.split('/').includes('..')) { fail(`${p.id}: unsafe path: ${name}`); safe = false; }
  });
  if (!safe) return null;

  const dir = mkdtempSync(join(tmpdir(), 'tessera-registry-'));
  const copy = join(dir, 'archive.tar.gz');
  writeFileSync(copy, data);
  tar(['-xzf', 'archive.tar.gz'], dir);
  rmSync(copy);

  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail(`${p.id}: ${p.url} has no manifest.json at its root`);
    return dir;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.id !== p.id || manifest.version !== p.version) {
    fail(`${p.id}: archive manifest is ${manifest.id}@${manifest.version}, registry.json says ${p.id}@${p.version}`);
  }
  // Printers check the entry, browsers the manifest: they must agree.
  if (normalizePluginApi(manifest.pluginApi) !== normalizePluginApi(p.pluginApi)) {
    fail(`${p.id}: archive manifest needs plugin API ${JSON.stringify(manifest.pluginApi)}, registry.json says ${JSON.stringify(p.pluginApi)}`);
  }
  if (typeof manifest.entry !== 'string' || !existsSync(join(dir, manifest.entry))) {
    fail(`${p.id}: manifest.entry "${manifest.entry}" is not in the archive`);
  }
  return dir;
}

const TAR_FIELDS = [
  ['name', 0, 100], ['mode', 100, 8], ['uid', 108, 8], ['gid', 116, 8], ['size', 124, 12],
  ['mtime', 136, 12], ['chksum', 148, 8], ['type', 156, 1], ['linkname', 157, 100],
  ['magic', 257, 8], ['uname', 265, 32], ['gname', 297, 32], ['devmajor', 329, 8], ['devminor', 337, 8],
];

/** Why two archives with the same files are not the same bytes: gzip, or which tar field. */
function describeDifference(published, rebuilt) {
  const runtime = `Node ${process.version}, zlib ${process.versions.zlib}`;
  const a = gunzipSync(published);
  const b = gunzipSync(rebuilt);
  if (a.equals(b)) {
    return `the tar streams are identical, only gzip differs (${published.length} and ${rebuilt.length} bytes, ${runtime})`;
  }
  if (a.length !== b.length) return `tar sizes differ: ${a.length} and ${b.length} (${runtime})`;
  const differences = [];
  for (let block = 0; block < a.length; block += 512) {
    if (a.subarray(block, block + 512).equals(b.subarray(block, block + 512))) continue;
    const text = (buf, start, length) => buf.subarray(block + start, block + start + length).toString('latin1').replace(/\0+$/, '');
    const fields = TAR_FIELDS.filter(([, start, length]) => text(a, start, length) !== text(b, start, length))
      .map(([field, start, length]) => `${field}: "${text(a, start, length)}" and "${text(b, start, length)}"`);
    differences.push(`block ${block / 512} (${text(a, 0, 100)}): ${fields.join(', ') || 'file contents'}`);
  }
  return `tar streams differ: ${differences.join('; ')} (${runtime})`;
}

function checkRebuild(p, unpacked) {
  const pluginDir = join(repo, 'plugins', p.dir);
  console.log(`\n=== ${p.id}: test, typecheck, build`);
  npm(['ci', '--no-audit', '--no-fund'], pluginDir);
  npm(['test'], pluginDir);
  npm(['run', 'typecheck'], pluginDir);
  npm(['run', 'build'], pluginDir);

  const built = hashTree(join(pluginDir, 'dist'));
  const published = hashTree(unpacked);
  for (const name of new Set([...built.keys(), ...published.keys()])) {
    if (!built.has(name)) fail(`${p.id}: ${name} is in ${p.url} but the sources do not build it`);
    else if (!published.has(name)) fail(`${p.id}: the sources build ${name}, ${p.url} does not have it`);
    else if (built.get(name) !== published.get(name)) {
      fail(`${p.id}: ${name} in ${p.url} differs from what plugins/${p.dir} builds. Changed code needs a new version and "npm run pack".`);
    }
  }

  // Same files should also mean the same bytes, as the README promises. Only a warning:
  // the files above are what matters, and a future zlib may compress differently.
  const packer = join(resolve(process.env.TESSERA_ROOT ?? join(repo, '..', 'Tessera')), 'tools', 'registry-pack.cjs');
  if (!existsSync(packer)) {
    warn(`${packer} not found: archive bytes not compared`);
    return;
  }
  const out = mkdtempSync(join(tmpdir(), 'tessera-repack-'));
  try {
    execFileSync(process.execPath, [packer, join(pluginDir, 'dist'), '--dir', p.dir, '--url-base', '.', '--out', out], { stdio: 'ignore' });
    const repacked = sha256(readFileSync(join(out, p.url)));
    if (repacked === p.sha256) console.log(`${p.id}: rebuilt archive is byte-identical (${repacked})`);
    else warn(`${p.id}: files match, but the rebuilt archive has sha256 ${repacked} instead of ${p.sha256}: ${describeDifference(readFileSync(join(registryDir, p.url)), readFileSync(join(out, p.url)))}`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

function main() {
  const registry = JSON.parse(readFileSync(join(registryDir, 'registry.json'), 'utf8'));
  if (registry.schema !== 1 || !Array.isArray(registry.plugins)) {
    fail('registry.json: expected {"schema": 1, "plugins": [...]}');
    return;
  }

  const seenIds = new Set();
  const seenDirs = new Set();
  const referenced = new Set(['registry.json']);

  for (const p of registry.plugins) {
    if (!checkEntryFields(p)) continue;
    if (seenIds.has(p.id)) fail(`${p.id}: listed twice`);
    if (seenDirs.has(p.dir)) fail(`${p.id}: dir "${p.dir}" is used by another plugin`);
    seenIds.add(p.id);
    seenDirs.add(p.dir);
    referenced.add(p.url);

    const pluginDir = join(repo, 'plugins', p.dir);
    if (!existsSync(join(pluginDir, 'manifest.json'))) {
      fail(`${p.id}: no sources in plugins/${p.dir}: every published plugin must be reviewable here`);
    } else {
      const source = JSON.parse(readFileSync(join(pluginDir, 'manifest.json'), 'utf8'));
      if (source.id !== p.id || source.version !== p.version) {
        fail(`${p.id}: plugins/${p.dir}/manifest.json is ${source.id}@${source.version}, registry.json says ${p.id}@${p.version}. Run "npm run pack".`);
      }
    }

    const unpacked = checkArchive(p);
    if (!unpacked) continue;
    try {
      if (rebuild && existsSync(pluginDir)) checkRebuild(p, unpacked);
    } catch (e) {
      fail(`${p.id}: ${e.message}`);
    } finally {
      rmSync(unpacked, { recursive: true, force: true });
    }
    console.log(`${p.id}@${p.version}: checked`);
  }

  for (const name of readdirSync(registryDir)) {
    if (!referenced.has(name)) warn(`registry/${name} is not referenced by registry.json`);
  }
  if (existsSync(join(repo, 'plugins'))) {
    for (const name of readdirSync(join(repo, 'plugins'))) {
      if (statSync(join(repo, 'plugins', name)).isDirectory() && !seenDirs.has(name)) {
        warn(`plugins/${name} is not published in registry.json`);
      }
    }
  }
}

main();
if (failures) {
  console.error(`\n${failures} problem(s) found`);
  process.exit(1);
}
console.log('\nRegistry is consistent');
