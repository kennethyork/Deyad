import { defineConfig } from 'vite';
import path from 'node:path';
import { builtinModules } from 'node:module';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    rollupOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    sourcemap: true,
    minify: false,
  },
});
