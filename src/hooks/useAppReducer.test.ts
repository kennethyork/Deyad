// @vitest-environment happy-dom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useAppReducer, defaultPerAppState } from './useAppReducer';
import type { AppProject } from '../App';

const app = (id = 'a1', name = 'Test'): AppProject => ({
  id, name, description: '', createdAt: '', appType: 'frontend',
});

describe('useAppReducer', () => {
  it('has correct initial state', () => {
    const { result } = renderHook(() => useAppReducer());
    expect(result.current.state.apps).toEqual([]);
    expect(result.current.state.selectedApp).toBeNull();
    expect(result.current.state.activeTasks).toBe(0);
  });

  it('SET_APPS updates apps list', () => {
    const { result } = renderHook(() => useAppReducer());
    const a = app();
    act(() => result.current.dispatch({ type: 'SET_APPS', apps: [a] }));
    expect(result.current.state.apps).toEqual([a]);
  });

  it('SELECT_APP sets selected app', () => {
    const { result } = renderHook(() => useAppReducer());
    const a = app();
    act(() => result.current.dispatch({ type: 'SELECT_APP', app: a }));
    expect(result.current.state.selectedApp).toEqual(a);
  });

  it('RENAME_APP updates app name and selected app', () => {
    const { result } = renderHook(() => useAppReducer());
    const a = app('a1', 'Old');
    act(() => {
      result.current.dispatch({ type: 'SET_APPS', apps: [a] });
      result.current.dispatch({ type: 'SELECT_APP', app: a });
      result.current.dispatch({ type: 'RENAME_APP', appId: 'a1', newName: 'New' });
    });
    expect(result.current.state.apps[0]?.name).toBe('New');
    expect(result.current.state.selectedApp?.name).toBe('New');
  });

  it('UPDATE_PER_APP merges partial state', () => {
    const { result } = renderHook(() => useAppReducer());
    act(() => result.current.updatePerApp('a1', { rightTab: 'terminal' }));
    expect(result.current.state.perApp['a1']?.rightTab).toBe('terminal');
    // Other defaults preserved
    expect(result.current.state.perApp['a1']?.selectedFile).toBeNull();
  });

  it('SET_PER_APP_FULL replaces full state', () => {
    const { result } = renderHook(() => useAppReducer());
    const full = { ...defaultPerAppState, rightTab: 'preview' as const };
    act(() => result.current.dispatch({ type: 'SET_PER_APP_FULL', appId: 'a1', state: full }));
    expect(result.current.state.perApp['a1']).toEqual(full);
  });

  it('OPEN_APP adds to openedApps (no duplicates)', () => {
    const { result } = renderHook(() => useAppReducer());
    act(() => {
      result.current.dispatch({ type: 'OPEN_APP', appId: 'a1' });
      result.current.dispatch({ type: 'OPEN_APP', appId: 'a1' });
    });
    expect(result.current.state.openedApps).toEqual(['a1']);
  });

  it('DELETE_APP_STATE cleans up perApp, openedApps, and selectedApp', () => {
    const { result } = renderHook(() => useAppReducer());
    const a = app();
    act(() => {
      result.current.dispatch({ type: 'SELECT_APP', app: a });
      result.current.dispatch({ type: 'OPEN_APP', appId: 'a1' });
      result.current.updatePerApp('a1', { rightTab: 'git' });
      result.current.dispatch({ type: 'DELETE_APP_STATE', appId: 'a1' });
    });
    expect(result.current.state.perApp['a1']).toBeUndefined();
    expect(result.current.state.openedApps).toEqual([]);
    expect(result.current.state.selectedApp).toBeNull();
  });

  it('SET_ACTIVE_TASKS updates count', () => {
    const { result } = renderHook(() => useAppReducer());
    act(() => result.current.dispatch({ type: 'SET_ACTIVE_TASKS', count: 3 }));
    expect(result.current.state.activeTasks).toBe(3);
  });

  it('REFRESH_PREVIEW increments key', () => {
    const { result } = renderHook(() => useAppReducer());
    act(() => result.current.dispatch({ type: 'REFRESH_PREVIEW' }));
    expect(result.current.state.previewRefreshKey).toBe(1);
  });

  it('SET_PENDING_PROMPT sets and clears', () => {
    const { result } = renderHook(() => useAppReducer());
    act(() => result.current.dispatch({ type: 'SET_PENDING_PROMPT', prompt: 'test' }));
    expect(result.current.state.pendingPrompt).toBe('test');
    act(() => result.current.dispatch({ type: 'SET_PENDING_PROMPT', prompt: null }));
    expect(result.current.state.pendingPrompt).toBeNull();
  });

  it('cur returns defaultPerAppState when no app selected', () => {
    const { result } = renderHook(() => useAppReducer());
    expect(result.current.cur).toEqual(defaultPerAppState);
  });

  it('cur returns perApp state for selected app', () => {
    const { result } = renderHook(() => useAppReducer());
    const a = app();
    act(() => {
      result.current.dispatch({ type: 'SELECT_APP', app: a });
      result.current.updatePerApp('a1', { rightTab: 'database' });
    });
    expect(result.current.cur.rightTab).toBe('database');
  });
});
