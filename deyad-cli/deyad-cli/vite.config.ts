import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.*', 'src/utils/singlepass/**', 'src/cli.ts', 'src/tui.ts', 'src/minimatch.d.ts'],
      thresholds: {
        statements: 75,
        branches: 79,
        functions: 91,
        lines: 75,
      },
    },
  },
});