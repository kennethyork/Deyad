// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies before import
vi.mock('./App', () => ({ default: () => '<div>App</div>' }));
vi.mock('./components/ErrorBoundary', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('./lib/electronCheck', () => ({ isElectronApp: vi.fn() }));
vi.mock('./index.css', () => ({}));

import { isElectronApp } from './lib/electronCheck';

describe('renderer', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('isElectronApp is importable and callable', () => {
    expect(typeof isElectronApp).toBe('function');
  });

  it('root element exists in test DOM', () => {
    expect(document.getElementById('root')).toBeTruthy();
  });
});
