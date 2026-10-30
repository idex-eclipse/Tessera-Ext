import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Tessera checkout used for development: by default the sibling of this
 * repository (…/Tessera-Ext/plugins/spoolman → …/Tessera). Override with
 * TESSERA_ROOT when the checkouts live elsewhere.
 */
const tesseraRoot = resolve(process.env.TESSERA_ROOT ?? resolve(here, '../../../Tessera'));

/**
 * dist/ = exactly what a printer receives: manifest.json + index.js.
 * In watch mode (`npm run dev`) the result is also copied to
 * <Tessera>/extensions/spoolman/, which Tessera's dev server serves as
 * /extensions/spoolman/ — so a rebuild + F5 shows the change.
 */
function deliver(dev: boolean): Plugin {
  return {
    name: 'tessera-deliver',
    writeBundle() {
      // Normalized formatting: the archive stays byte-identical for unchanged sources.
      const manifest = JSON.parse(readFileSync(resolve(here, 'manifest.json'), 'utf8'));
      writeFileSync(resolve(here, 'dist/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      if (dev) {
        const target = resolve(tesseraRoot, 'extensions/spoolman');
        mkdirSync(target, { recursive: true });
        cpSync(resolve(here, 'dist'), target, { recursive: true });
        console.log(`[tessera-deliver] → ${target}`);
      }
    },
  };
}

/**
 * Remote plugins are loaded by the host with a plain `import(entryUrl)`, so the
 * build must produce ONE self-contained ES module:
 *
 * - lib mode, format 'es', file name equal to manifest.entry ("index.js");
 * - nothing external: a bare `import 'preact'` cannot be resolved by the
 *   browser, so Preact and signals are bundled in (they are ~10 KB together);
 * - `process.env.NODE_ENV` is defined explicitly: lib builds do not replace it,
 *   and any dependency that reads it would throw a ReferenceError in the browser.
 */
export default defineConfig(({ mode }) => ({
  esbuild: {
    // TSX → Preact's automatic JSX runtime (no `import { h }` in every file).
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  plugins: [deliver(mode === 'dev')],
  build: {
    target: 'es2022',
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { external: [] },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
