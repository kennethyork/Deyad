// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import VersionHistoryPanel from './VersionHistoryPanel';

const mockCommits = [
  { hash: 'abc123', message: 'Add feature X', date: '2026-03-01' },
  { hash: 'def456', message: 'Initial scaffold', date: '2026-02-28' },
];

beforeEach(() => {
  window.deyad = {
    gitLog: vi.fn().mockResolvedValue(mockCommits),
    gitDiffStat: vi.fn().mockResolvedValue([
      { status: 'M', path: 'src/App.tsx' },
      { status: 'A', path: 'src/utils.ts' },
    ]),
    gitShow: vi.fn().mockResolvedValue('const x = 1;'),
    gitCheckout: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as DeyadAPI;
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
      expect(window.deyad.gitLog).toHaveBeenCalledWith('app1');
    });
  });

  it('shows changed files when a commit is selected', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    fireEvent.click(screen.getByText('Add feature X'));
    await waitFor(() => {
      expect(window.deyad.gitDiffStat).toHaveBeenCalledWith('app1', 'abc123');
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
    Object.assign(window.deyad, { gitLog: vi.fn().mockResolvedValue([]) });
    const { container } = render(
      <VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />,
    );
    await waitFor(() => {
      expect(window.deyad.gitLog).toHaveBeenCalled();
    });
    // Should render without crashing
    expect(container.innerHTML).toBeTruthy();
  });
});

describe('VersionHistoryPanel — file viewing', () => {
  it('clicking a file calls gitShow and displays content', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    fireEvent.click(screen.getByText('Add feature X'));
    await waitFor(() => expect(screen.getByText('src/App.tsx')).toBeTruthy());
    fireEvent.click(screen.getByText('src/App.tsx'));
    await waitFor(() => {
      expect(window.deyad.gitShow).toHaveBeenCalledWith('app1', 'abc123', 'src/App.tsx');
      expect(screen.getByText('const x = 1;')).toBeTruthy();
    });
  });

  it('Back button returns to file list from file view', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    fireEvent.click(screen.getByText('Add feature X'));
    await waitFor(() => expect(screen.getByText('src/App.tsx')).toBeTruthy());
    fireEvent.click(screen.getByText('src/App.tsx'));
    await waitFor(() => expect(screen.getByText('← Back')).toBeTruthy());
    fireEvent.click(screen.getByText('← Back'));
    await waitFor(() => expect(screen.getByText('src/App.tsx')).toBeTruthy());
  });
});

describe('VersionHistoryPanel — restore', () => {
  it('clicking Restore opens confirm dialog', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    fireEvent.click(screen.getByText('Add feature X'));
    await waitFor(() => expect(screen.getByText('Restore This Version')).toBeTruthy());
    fireEvent.click(screen.getByText('Restore This Version'));
    await waitFor(() => expect(screen.getByText('Restore Version')).toBeTruthy());
  });

  it('confirming restore calls gitCheckout and onRestore', async () => {
    const onRestore = vi.fn();
    const onClose = vi.fn();
    render(<VersionHistoryPanel appId="app1" onClose={onClose} onRestore={onRestore} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    fireEvent.click(screen.getByText('Add feature X'));
    await waitFor(() => expect(screen.getByText('Restore This Version')).toBeTruthy());
    fireEvent.click(screen.getByText('Restore This Version'));
    await waitFor(() => expect(screen.getByText('Restore')).toBeTruthy());
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => {
      expect(window.deyad.gitCheckout).toHaveBeenCalledWith('app1', 'abc123');
      expect(onRestore).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('failed restore shows error banner', async () => {
    Object.assign(window.deyad, {
      gitCheckout: vi.fn().mockResolvedValue({ success: false, error: 'merge conflict' }),
    });
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    fireEvent.click(screen.getByText('Add feature X'));
    await waitFor(() => expect(screen.getByText('Restore This Version')).toBeTruthy());
    fireEvent.click(screen.getByText('Restore This Version'));
    await waitFor(() => expect(screen.getByText('Restore')).toBeTruthy());
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => expect(screen.getByText(/merge conflict/)).toBeTruthy());
  });

  it('error banner dismiss clears error', async () => {
    Object.assign(window.deyad, {
      gitCheckout: vi.fn().mockResolvedValue({ success: false, error: 'fail' }),
    });
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    fireEvent.click(screen.getByText('Add feature X'));
    await waitFor(() => expect(screen.getByText('Restore This Version')).toBeTruthy());
    fireEvent.click(screen.getByText('Restore This Version'));
    await waitFor(() => expect(screen.getByText('Restore')).toBeTruthy());
    fireEvent.click(screen.getByText('Restore'));
    await waitFor(() => expect(screen.getByText(/fail/)).toBeTruthy());
    fireEvent.click(screen.getByText('✕'));
    await waitFor(() => expect(screen.queryByText(/fail/)).toBeFalsy());
  });
});

describe('VersionHistoryPanel — file status icons', () => {
  it('shows + for added files', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    fireEvent.click(screen.getByText('Add feature X'));
    await waitFor(() => {
      // src/utils.ts has status 'A' → should show '+'
      const statuses = screen.getAllByText('+');
      expect(statuses.length).toBeGreaterThan(0);
    });
  });

  it('shows ~ for modified files', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Add feature X')).toBeTruthy());
    fireEvent.click(screen.getByText('Add feature X'));
    await waitFor(() => {
      // src/App.tsx has status 'M' → should show '~'
      const statuses = screen.getAllByText('~');
      expect(statuses.length).toBeGreaterThan(0);
    });
  });
});

describe('VersionHistoryPanel — overlay interactions', () => {
  it('overlay click calls onClose', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <VersionHistoryPanel appId="app1" onClose={onClose} onRestore={() => {}} />,
    );
    const overlay = container.querySelector('.modal-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('modal body click does not call onClose', async () => {
    const onClose = vi.fn();
    const { container } = render(
      <VersionHistoryPanel appId="app1" onClose={onClose} onRestore={() => {}} />,
    );
    const modal = container.querySelector('.modal')!;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('VersionHistoryPanel — empty states', () => {
  it('shows "No commits yet" for empty history', async () => {
    Object.assign(window.deyad, { gitLog: vi.fn().mockResolvedValue([]) });
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('No commits yet')).toBeTruthy());
  });

  it('shows prompt to select commit when none selected', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('Select a commit to see details')).toBeTruthy());
  });

  it('displays commit hash prefix (7 chars)', async () => {
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('abc123')).toBeTruthy());
  });
});

describe('VersionHistoryPanel — gitLog failure', () => {
  it('shows empty state when gitLog rejects', async () => {
    Object.assign(window.deyad, { gitLog: vi.fn().mockRejectedValue(new Error('nope')) });
    render(<VersionHistoryPanel appId="app1" onClose={() => {}} onRestore={() => {}} />);
    await waitFor(() => expect(screen.getByText('No commits yet')).toBeTruthy());
  });
});
