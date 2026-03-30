// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VersionHistoryPanel from './VersionHistoryPanel';

const mockCommits = [
  { hash: 'abc123', message: 'Add feature X', date: '2026-03-01' },
  { hash: 'def456', message: 'Initial scaffold', date: '2026-02-28' },
];

beforeEach(() => {
  (window as any).dyad = {
    gitLog: vi.fn().mockResolvedValue(mockCommits),
    gitDiffStat: vi.fn().mockResolvedValue([
      { status: 'M', path: 'src/App.tsx' },
      { status: 'A', path: 'src/utils.ts' },
    ]),
    gitShow: vi.fn().mockResolvedValue('const x = 1;'),
    gitCheckout: vi.fn().mockResolvedValue({ success: true }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VersionHistoryPanel', () => {
  it('loads and displays commits', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Add feature X')).toBeTruthy();
      expect(screen.getByText('Initial scaffold')).toBeTruthy();
    });
  });

  it('calls gitLog on mount', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => {
      expect(window.dyad.gitLog).toHaveBeenCalledWith('app1');
    });
  });

  it('shows changed files when a commit is selected', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    fireEvent.click(screen.getByText('Add feature X'));
    await waitFor(() => {
      expect(window.dyad.gitDiffStat).toHaveBeenCalledWith('app1', 'abc123');
      expect(screen.getByText('src/App.tsx')).toBeTruthy();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<VersionHistoryPanel appId="app1" onClose={onClose} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    // Find and click the close / back button
    const closeBtn = screen.getByText('×');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('handles empty commit history', async () => {
    (window as any).dyad.gitLog = vi.fn().mockResolvedValue([]);
    const { container } = render(
      <VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />,
    );
    await waitFor(() => {
      expect(window.dyad.gitLog).toHaveBeenCalled();
    });
    // Should render without crashing
    expect(container.innerHTML).toBeTruthy();
  });
});
