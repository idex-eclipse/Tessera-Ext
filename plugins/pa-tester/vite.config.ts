import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Tessera checkout used for development: by default the sibling of this
 * repository (…/Tessera-Ext/plugins/pa-tester → …/Tessera). Override with
 * TESSERA_ROOT when the checkouts live elsewhere.
 */
const tesseraRoot = resolve(process.env.TESSERA_ROOT ?? resolve(here, '../../../Tessera'));

/**
 * dist/ = exactly what a printer receives: manifest.json + index.js.
 * In watch mode (`npm run dev`) the result is also copied to
 * <Tessera>/extensions/pa-tester/, which Tessera's dev server serves as
 * /extensions/pa-tester/ — so a rebuild + F5 shows the change.
 */
function deliver(dev: boolean): Plugin {
  return {
    name: 'tessera-deliver',
    writeBundle() {
      // Normalized formatting: the archive stays byte-identical for unchanged sources.
      const manifest = JSON.parse(readFileSync(resolve(here, 'manifest.json'), 'utf8'));
      writeFileSync(resolve(here, 'dist/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
      if (dev) {
        const target = resolve(tesseraRoot, 'extensions/pa-tester');
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
 * - nothing external: a bare `import 'lit'` cannot be resolved by the browser,
 *   so Lit is bundled in (lit-html + reactive-element, ~6 KB gzip);
 * - `process.env.NODE_ENV` is defined explicitly: lib builds do not replace it.
 *   Lit reads it only in its dev build, but the define keeps any dependency
 *   from throwing a ReferenceError in the browser.
 */
export default defineConfig(({ mode }) => ({
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
