// @vitest-environment happy-dom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useModals } from './useModals';

describe('useModals', () => {
  it('all modals start closed', () => {
    const { result } = renderHook(() => useModals());
    expect(result.current.showNewAppModal).toBe(false);
    expect(result.current.showSettings).toBe(false);
    expect(result.current.showImportModal).toBe(false);
    expect(result.current.showDeployModal).toBe(false);
    expect(result.current.showTaskQueue).toBe(false);
    expect(result.current.showVersionHistory).toBe(false);
    expect(result.current.showCommandPalette).toBe(false);
    expect(result.current.showWizard).toBe(false);
  });

  it('setter opens and closes a modal', () => {
    const { result } = renderHook(() => useModals());
    act(() => result.current.setShowSettings(true));
    expect(result.current.showSettings).toBe(true);
    act(() => result.current.setShowSettings(false));
    expect(result.current.showSettings).toBe(false);
  });

  it('setter accepts a function updater', () => {
    const { result } = renderHook(() => useModals());
    act(() => result.current.setShowSettings(prev => !prev));
    expect(result.current.showSettings).toBe(true);
    act(() => result.current.setShowSettings(prev => !prev));
    expect(result.current.showSettings).toBe(false);
  });

  it('openModal / closeModal work', () => {
    const { result } = renderHook(() => useModals());
    act(() => result.current.openModal('showNewAppModal'));
    expect(result.current.showNewAppModal).toBe(true);
    act(() => result.current.closeModal('showNewAppModal'));
    expect(result.current.showNewAppModal).toBe(false);
  });

  it('exportConfirm manages state', () => {
    const { result } = renderHook(() => useModals());
    expect(result.current.exportConfirm).toEqual({ open: false, appId: '' });
    act(() => result.current.setExportConfirm({ open: true, appId: 'app-1' }));
    expect(result.current.exportConfirm).toEqual({ open: true, appId: 'app-1' });
  });

  it('exportResult manages state', () => {
    const { result } = renderHook(() => useModals());
    expect(result.current.exportResult).toBeNull();
    act(() => result.current.setExportResult('exported!'));
    expect(result.current.exportResult).toBe('exported!');
    act(() => result.current.setExportResult(null));
    expect(result.current.exportResult).toBeNull();
  });
});
