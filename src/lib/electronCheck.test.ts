import { describe, it, expect, vi, afterEach } from 'vitest';
import { isElectronApp } from './electronCheck';

describe('isElectronApp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when window.dyad is defined', () => {
    vi.stubGlobal('window', { dyad: {} });
    expect(isElectronApp()).toBe(true);
  });

  it('returns false when window.dyad is undefined', () => {
    vi.stubGlobal('window', {});
    expect(isElectronApp()).toBe(false);
  });

  it('returns false when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    expect(isElectronApp()).toBe(false);
  });
});
