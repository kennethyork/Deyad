// @vitest-environment happy-dom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSettings } from './useSettings';

// Mock window.deyad
const mockGetSettings = vi.fn();
Object.defineProperty(window, 'deyad', {
  value: { getSettings: mockGetSettings },
  writable: true,
});

describe('useSettings', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetSettings.mockReset();
  });

  it('defaults to dark theme', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.theme).toBe('dark');
  });

  it('reads theme from localStorage', () => {
    localStorage.setItem('deyad-theme', 'light');
    const { result } = renderHook(() => useSettings());
    expect(result.current.theme).toBe('light');
  });

  it('autocomplete defaults to false', () => {
    const { result } = renderHook(() => useSettings());
    expect(result.current.autocompleteEnabled).toBe(false);
  });

  it('setTheme updates theme', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current.setTheme('light'));
    expect(result.current.theme).toBe('light');
  });

  it('loadSettings updates state from IPC', async () => {
    mockGetSettings.mockResolvedValue({
      autocompleteEnabled: true,
      completionModel: 'gpt-4',
      defaultModel: 'gpt-3.5',
      theme: 'light',
    });
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await result.current.loadSettings();
    });
    expect(result.current.autocompleteEnabled).toBe(true);
    expect(result.current.completionModel).toBe('gpt-4');
    expect(result.current.defaultModel).toBe('gpt-3.5');
    expect(result.current.theme).toBe('light');
  });

  it('loadSettings handles errors gracefully', async () => {
    mockGetSettings.mockRejectedValue(new Error('no ipc'));
    const { result } = renderHook(() => useSettings());
    let settings: unknown;
    await act(async () => {
      settings = await result.current.loadSettings();
    });
    expect(settings).toBeNull();
  });
});
