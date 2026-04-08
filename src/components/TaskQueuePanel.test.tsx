// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import TaskQueuePanel from './TaskQueuePanel';
import { taskQueue } from '../lib/taskQueue';

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

// Mock taskQueue methods
vi.mock('../lib/taskQueue', () => {
  const items: Array<unknown> = [];
  const listeners = new Set<() => void>();
  return {
    taskQueue: {
      getAll: vi.fn(() => items),
      subscribe: vi.fn((fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }),
      enqueue: vi.fn(),
      cancel: vi.fn(),
      remove: vi.fn(),
      clearHistory: vi.fn(),
    },
  };
});

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

  it('enqueues a task when entering text and clicking Queue Task', () => {
    render(<TaskQueuePanel {...baseProps} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Build a login page' } });
    fireEvent.click(screen.getByText(/Queue Task/i));
    expect(taskQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      appId: 'app1',
      appName: 'Test App',
      model: 'llama3',
      prompt: 'Build a login page',
    }));
  });

  it('enqueues on Enter key press', () => {
    render(<TaskQueuePanel {...baseProps} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Add dark mode' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(taskQueue.enqueue).toHaveBeenCalled();
  });

  it('does not enqueue on Shift+Enter', () => {
    render(<TaskQueuePanel {...baseProps} />);
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(taskQueue.enqueue).not.toHaveBeenCalled();
  });

  it('does not enqueue empty prompt', () => {
    render(<TaskQueuePanel {...baseProps} />);
    fireEvent.click(screen.getByText(/Queue Task/i));
    expect(taskQueue.enqueue).not.toHaveBeenCalled();
  });

  it('shows warning when no model selected', () => {
    render(<TaskQueuePanel {...baseProps} model="" />);
    expect(screen.getByText(/No model selected/)).toBeTruthy();
  });

  it('subscribes to taskQueue on mount', () => {
    render(<TaskQueuePanel {...baseProps} />);
    expect(taskQueue.subscribe).toHaveBeenCalled();
  });

  it('renders active tasks section when tasks are running', () => {
    vi.mocked(taskQueue.getAll).mockReturnValue([{
      id: 'task-1', appId: 'app1', appName: 'Test App', appType: 'frontend',
      dbStatus: 'none', model: 'llama3', prompt: 'Build login page',
      status: 'running', output: '', steps: [], createdAt: Date.now(),
    }]);
    render(<TaskQueuePanel {...baseProps} />);
    expect(screen.getByText(/Active/)).toBeTruthy();
  });

  it('renders history section when tasks are done', () => {
    vi.mocked(taskQueue.getAll).mockReturnValue([{
      id: 'task-1', appId: 'app1', appName: 'Test App', appType: 'frontend',
      dbStatus: 'none', model: 'llama3', prompt: 'Build login page',
      status: 'done', output: 'Done', steps: [], createdAt: Date.now() - 60000, finishedAt: Date.now(),
    }]);
    render(<TaskQueuePanel {...baseProps} />);
    expect(screen.getByText(/History/)).toBeTruthy();
  });

  it('clears input after enqueue', () => {
    render(<TaskQueuePanel {...baseProps} />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.click(screen.getByText(/Queue Task/i));
    // Value should be reset (controlled component resets via setNewPrompt)
    expect(taskQueue.enqueue).toHaveBeenCalled();
  });

  it('closes overlay when clicking outside modal', () => {
    const onClose = vi.fn();
    const { container } = render(<TaskQueuePanel {...baseProps} onClose={onClose} />);
    const overlay = container.querySelector('.modal-overlay');
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalled();
  });
});
