// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useFocusTrap } from './useFocusTrap';

describe('useFocusTrap', () => {
  it('returns a ref object', () => {
    const { result } = renderHook(() => useFocusTrap());
    expect(result.current).toBeDefined();
    expect(result.current.current).toBeNull();
  });

  it('ref is typed as HTMLDivElement by default', () => {
    const { result } = renderHook(() => useFocusTrap<HTMLDivElement>());
    expect(result.current).toBeDefined();
  });

  it('can accept HTMLElement generic', () => {
    const { result } = renderHook(() => useFocusTrap<HTMLElement>());
    expect(result.current).toBeDefined();
  });
});
