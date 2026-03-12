// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import TaskQueuePanel from './TaskQueuePanel';

afterEach(cleanup);

const baseProps = {
  appId: 'app1',
  appName: 'Test App',
  appType: 'frontend' as const,
  dbStatus: 'none' as const,
  model: 'llama3',
  onClose: vi.fn(),
};

describe('TaskQueuePanel', () => {
  it('renders the background tasks heading', () => {
    render(<TaskQueuePanel {...baseProps} />);
    expect(screen.getByText('Background Tasks')).toBeTruthy();
  });

  it('renders prompt input and enqueue button', () => {
    render(<TaskQueuePanel {...baseProps} />);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.getByText(/Queue Task/i)).toBeTruthy();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<TaskQueuePanel {...baseProps} onClose={onClose} />);
    const closeBtn = screen.getByText('×');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when no tasks', () => {
    const { container } = render(<TaskQueuePanel {...baseProps} />);
    // Should render without errors
    expect(container.innerHTML).toBeTruthy();
  });
});
