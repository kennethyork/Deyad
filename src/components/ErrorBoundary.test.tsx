// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import ErrorBoundary from './ErrorBoundary';

function Thrower({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('test kaboom');
  return <div>All good</div>;
}

describe('ErrorBoundary', () => {
  afterEach(() => cleanup());
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <Thrower shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('All good')).toBeTruthy();
  });

  it('shows error UI when child throws', () => {
    // Suppress React error boundary console spam
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('test kaboom')).toBeTruthy();
    expect(screen.getByText('Reload App')).toBeTruthy();

    spy.mockRestore();
  });

  it('renders Reload App button in error state', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Thrower shouldThrow={true} />
      </ErrorBoundary>,
    );

    const btn = screen.getByText('Reload App');
    expect(btn).toBeTruthy();
    expect(btn.tagName).toBe('BUTTON');

    spy.mockRestore();
  });
});
