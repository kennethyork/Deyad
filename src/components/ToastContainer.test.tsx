// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { ToastProvider, useToast } from './ToastContainer';

function TestConsumer() {
  const { addToast } = useToast();
  return (
    <div>
      <button onClick={() => addToast('success', 'Saved!')}>add-success</button>
      <button onClick={() => addToast('error', 'Failed!')}>add-error</button>
      <button onClick={() => addToast('info', 'FYI')}>add-info</button>
      <button onClick={() => addToast('warning', 'Watch out')}>add-warning</button>
    </div>
  );
}

describe('ToastContainer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders children', () => {
    render(<ToastProvider><div>child</div></ToastProvider>);
    expect(screen.getByText('child')).toBeTruthy();
  });

  it('adds and displays a toast', () => {
    render(<ToastProvider><TestConsumer /></ToastProvider>);
    fireEvent.click(screen.getByText('add-success'));
    expect(screen.getByText('Saved!')).toBeTruthy();
  });

  it('removes toast after timeout', () => {
    render(<ToastProvider><TestConsumer /></ToastProvider>);
    fireEvent.click(screen.getByText('add-success'));
    expect(screen.getByText('Saved!')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByText('Saved!')).toBeNull();
  });

  it('dismisses toast on click', () => {
    render(<ToastProvider><TestConsumer /></ToastProvider>);
    fireEvent.click(screen.getByText('add-error'));
    const toastMsg = screen.getByText('Failed!');
    fireEvent.click(toastMsg.closest('.toast')!);
    expect(screen.queryByText('Failed!')).toBeNull();
  });

  it('shows correct icons for each type', () => {
    render(<ToastProvider><TestConsumer /></ToastProvider>);
    fireEvent.click(screen.getByText('add-success'));
    expect(screen.getByText('✓')).toBeTruthy();
    fireEvent.click(screen.getByText('add-error'));
    expect(screen.getByText('✗')).toBeTruthy();
  });

  it('keeps max 5 toasts', () => {
    const { container } = render(<ToastProvider><TestConsumer /></ToastProvider>);
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByText('add-info'));
    }
    const toasts = container.querySelectorAll('.toast');
    expect(toasts.length).toBeLessThanOrEqual(5);
  });
});
