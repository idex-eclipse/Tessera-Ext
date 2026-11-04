// Publishes the built plugin into this repository's registry.
//
// Runs Tessera's tools/registry-pack.cjs on dist/ (manifest.json + index.js —
// exactly what a printer receives) and writes the archive and its entry into
// <Tessera-Ext>/registry/. Commit both afterwards.
//
// Usage: npm run pack [-- <url-base> [<out-dir>]]
//   url-base defaults to "." (archive URLs relative to registry.json)
//   out-dir  defaults to the repository's registry/ folder
// Env: TESSERA_ROOT — Tessera checkout (default: sibling folder ../Tessera)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '../..');
const [urlBase = '.', outDir = resolve(repo, 'registry')] = process.argv.slice(2);

for (const file of ['index.js', 'manifest.json']) {
  if (!existsSync(resolve(root, 'dist', file))) {
    console.error(`dist/${file} not found: run \`npm run build\` first`);
    process.exit(1);
  }
}

const tesseraRoot = resolve(process.env.TESSERA_ROOT ?? resolve(repo, '../Tessera'));
const packer = resolve(tesseraRoot, 'tools/registry-pack.cjs');
if (!existsSync(packer)) {
  console.error(`${packer} not found: clone Tessera next to this repository or set TESSERA_ROOT`);
  process.exit(1);
}

execFileSync(process.execPath, [packer, resolve(root, 'dist'), '--dir', 'motion-diag', '--url-base', urlBase, '--out', resolve(outDir)], {
  stdio: 'inherit',
});
