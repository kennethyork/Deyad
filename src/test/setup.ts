import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock window.matchMedia required by xterm.js in browser-like environments.
// Guard is needed because this setup file also runs in the 'node' environment
// (for lib/*.test.ts files that don't specify @vitest-environment).
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
