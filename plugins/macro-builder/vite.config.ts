import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

/** Keep Blockly in an imported chunk, which only the first dialog opening loads. */
export default defineConfig(({ mode }) => ({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  plugins: [{
    name: 'macro-builder-deliver',
    writeBundle() {
      const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8')) as unknown;
      writeFileSync(resolve(root, 'dist/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      if (mode === 'dev') {
        const target = resolve(process.env.TESSERA_ROOT ?? resolve(root, '../../../Tessera'), 'extensions/macro-builder');
        mkdirSync(target, { recursive: true });
        cpSync(resolve(root, 'dist'), target, { recursive: true });
      }
    },
  }],
  build: {
    target: 'es2022',
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { output: { chunkFileNames: 'assets/[name]-[hash].js' } },
  },
  test: { include: ['src/**/*.test.ts'] },
}));
