import { describe, it, expect, vi, afterEach } from 'vitest';
import { isElectronApp } from './electronCheck';

describe('isElectronApp', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when window.deyad is defined', () => {
    vi.stubGlobal('window', { deyad: {} });
    expect(isElectronApp()).toBe(true);
  });

  it('returns false when window.deyad is undefined', () => {
    vi.stubGlobal('window', {});
    expect(isElectronApp()).toBe(false);
  });

  it('returns false when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    expect(isElectronApp()).toBe(false);
  });
});
