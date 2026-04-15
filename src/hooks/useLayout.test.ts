// @vitest-environment happy-dom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useLayout } from './useLayout';

describe('useLayout', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.cssText = '';
  });

  it('returns default sidebar width of 220', () => {
    const { result } = renderHook(() => useLayout());
    expect(result.current.sidebarWidth).toBe(220);
  });

  it('returns default right width of 340', () => {
    const { result } = renderHook(() => useLayout());
    expect(result.current.rightWidth).toBe(340);
  });

  it('reads sidebar width from localStorage', () => {
    localStorage.setItem('sidebarWidth', '300');
    const { result } = renderHook(() => useLayout());
    expect(result.current.sidebarWidth).toBe(300);
  });

  it('reads right width from localStorage', () => {
    localStorage.setItem('rightWidth', '500');
    const { result } = renderHook(() => useLayout());
    expect(result.current.rightWidth).toBe(500);
  });

  it('sidebar starts visible', () => {
    const { result } = renderHook(() => useLayout());
    expect(result.current.sidebarVisible).toBe(true);
  });

  it('mobile panel defaults to chat', () => {
    const { result } = renderHook(() => useLayout());
    expect(result.current.mobilePanel).toBe('chat');
  });

  it('setSidebarWidth updates state', () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setSidebarWidth(400));
    expect(result.current.sidebarWidth).toBe(400);
  });

  it('setRightWidth updates state', () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setRightWidth(600));
    expect(result.current.rightWidth).toBe(600);
  });

  it('persists sidebar width to localStorage', () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setSidebarWidth(350));
    expect(localStorage.getItem('sidebarWidth')).toBe('350');
  });

  it('persists right width to localStorage', () => {
    const { result } = renderHook(() => useLayout());
    act(() => result.current.setRightWidth(550));
    expect(localStorage.getItem('rightWidth')).toBe('550');
  });

  it('startDrag is a function', () => {
    const { result } = renderHook(() => useLayout());
    expect(typeof result.current.startDrag).toBe('function');
  });
});
