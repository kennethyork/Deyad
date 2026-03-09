import { defineConfig } from 'vite';
import path from 'node:path';
import { builtinModules } from 'node:module';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    outDir: '.vite/build',
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'src/main.ts'),
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    rollupOptions: {
      external: [
        'electron',
        'node-pty',
        'electron-squirrel-startup',
        'update-electron-app',
        ...builtinModules,
        ...builtinModules.map((m) => `node:${m}`),
      ],
    },
    sourcemap: true,
    minify: false,
  },
});
