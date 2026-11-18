import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The host packer hashes the entire dist tree, including Blockly's lazy chunk.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(root, '../..');
const tessera = resolve(process.env.TESSERA_ROOT ?? resolve(repo, '../Tessera'));
execFileSync(process.execPath, [resolve(tessera, 'tools/registry-pack.cjs'), resolve(root, 'dist'),
  '--dir', 'macro-builder', '--url-base', '.', '--out', resolve(repo, 'registry')], { stdio: 'inherit' });
