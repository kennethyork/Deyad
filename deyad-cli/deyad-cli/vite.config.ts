import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.*', 'src/utils/singlepass/**', 'src/cli.tsx', 'src/tui.ts'],
      thresholds: {
        statements: 50,
        branches: 60,
        functions: 60,
        lines: 50,
      },
    },
  },
});