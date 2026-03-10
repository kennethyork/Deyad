import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 9245,
    strictPort: false,
  },
  build: {
    outDir: '.vite/renderer/main_window',
    emptyOutDir: true,
  },
});
