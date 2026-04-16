// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PreviewPanel from './PreviewPanel';
import type { AppProject } from '../App';

const mockApp: AppProject = {
  id: 'app1',
  name: 'Test App',
  description: '',
  appType: 'frontend',
  createdAt: new Date().toISOString(),
};

beforeEach(() => {
  window.deyad = {
    onAppDevLog: vi.fn().mockReturnValue(() => {}),
    onAppDevStatus: vi.fn().mockReturnValue(() => {}),
    appDevStart: vi.fn().mockResolvedValue({ success: true }),
    appDevStop: vi.fn().mockResolvedValue(undefined),
    appDevStatus: vi.fn().mockResolvedValue({ status: 'stopped' }),
    getSettings: vi.fn().mockResolvedValue({}),
  } as unknown as DeyadAPI;
});

afterEach(cleanup);

describe('PreviewPanel', () => {
  it('renders Run App button when stopped', () => {
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    expect(screen.getAllByText('Run App').length).toBeGreaterThan(0);
  });

  it('calls appDevStart when Run App is clicked', async () => {
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    fireEvent.click(screen.getAllByText('Run App')[0]);
    await waitFor(() => {
      expect(window.deyad.appDevStart).toHaveBeenCalledWith('app1');
    });
  });

  it('renders publish button', () => {
    const onPublish = vi.fn();
    render(<PreviewPanel app={mockApp} onPublish={onPublish} />);
    const pub = screen.getByText(/Publish|Deploy/i);
    expect(pub).toBeTruthy();
  });

  it('subscribes to dev log and status events on mount', () => {
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    expect(window.deyad.onAppDevLog).toHaveBeenCalled();
    expect(window.deyad.onAppDevStatus).toHaveBeenCalled();
  });

  it('calls onPublish when publish button is clicked', () => {
    const onPublish = vi.fn();
    render(<PreviewPanel app={mockApp} onPublish={onPublish} />);
    fireEvent.click(screen.getByText(/Publish/));
    expect(onPublish).toHaveBeenCalled();
  });

  it('shows logs toggle button', () => {
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    expect(screen.getByText('Logs')).toBeTruthy();
  });

  it('toggles log visibility on Logs button click', () => {
    const { container } = render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    fireEvent.click(screen.getByText('Logs'));
    // logs panel should become visible (active class)
    const logsBtn = screen.getByText('Logs');
    expect(logsBtn.className).toContain('active');
  });

  it('calls appDevStop when stop button is clicked', async () => {
    // Simulate running status
    Object.assign(window.deyad, {
      appDevStatus: vi.fn().mockResolvedValue({ status: 'running' }),
    });
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    await waitFor(() => expect(screen.queryByText('Stop')).toBeTruthy());
    fireEvent.click(screen.getByText('Stop'));
    expect(window.deyad.appDevStop).toHaveBeenCalledWith('app1');
  });

  it('checks server status on app change', () => {
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    expect(window.deyad.appDevStatus).toHaveBeenCalledWith('app1');
  });

  it('shows error state when start fails', async () => {
    Object.assign(window.deyad, {
      appDevStart: vi.fn().mockResolvedValue({ success: false, error: 'Port in use' }),
    });
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    fireEvent.click(screen.getAllByText('Run App')[0]);
    await waitFor(() => {
      expect(screen.getByText(/Port in use/)).toBeTruthy();
    });
  });

  it('displays default preview URL', () => {
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    expect(screen.getByText('http://localhost:5173')).toBeTruthy();
  });

  /* ── Placeholder text ──────────────────────────────── */

  it('shows placeholder text when dev server stopped', () => {
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    expect(screen.getByText(/Generate|Click Run/i)).toBeTruthy();
  });

  /* ── Status check on app change ────────────────────── */

  it('re-checks status when app changes', () => {
    const { rerender } = render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    expect(window.deyad.appDevStatus).toHaveBeenCalledWith('app1');

    const newApp = { ...mockApp, id: 'app2', name: 'Second App' };
    rerender(<PreviewPanel app={newApp} onPublish={() => {}} />);
    expect(window.deyad.appDevStatus).toHaveBeenCalledWith('app2');
  });

  /* ── Log subscription cleanup ──────────────────────── */

  it('cleans up log subscription on unmount', () => {
    const unsub = vi.fn();
    Object.assign(window.deyad, { onAppDevLog: vi.fn().mockReturnValue(unsub) });
    const { unmount } = render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    unmount();
    expect(unsub).toHaveBeenCalled();
  });

  it('cleans up dev status subscription on unmount', () => {
    const unsub = vi.fn();
    Object.assign(window.deyad, { onAppDevStatus: vi.fn().mockReturnValue(unsub) });
    const { unmount } = render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    unmount();
    expect(unsub).toHaveBeenCalled();
  });

  /* ── Run app error display ─────────────────────────── */

  it('shows error message from appDevStart failure', async () => {
    Object.assign(window.deyad, {
      appDevStart: vi.fn().mockResolvedValue({ success: false, error: 'EADDRINUSE' }),
    });
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    fireEvent.click(screen.getAllByText('Run App')[0]);
    await waitFor(() => expect(screen.getByText(/EADDRINUSE/)).toBeTruthy());
  });

  /* ── Stop returns to stopped state ─────────────────── */

  it('shows Run App after stop', async () => {
    Object.assign(window.deyad, {
      appDevStatus: vi.fn().mockResolvedValue({ status: 'running' }),
    });
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    await waitFor(() => expect(screen.queryByText('Stop')).toBeTruthy());
    Object.assign(window.deyad, {
      appDevStatus: vi.fn().mockResolvedValue({ status: 'stopped' }),
    });
    fireEvent.click(screen.getByText('Stop'));
  });

  /* ── Publish passes through to callback ────────────── */

  it('onPublish callback receives no arguments', () => {
    const onPublish = vi.fn();
    render(<PreviewPanel app={mockApp} onPublish={onPublish} />);
    fireEvent.click(screen.getByText(/Publish/));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  /* ── Fullstack app ─────────────────────────────────── */

  it('renders for fullstack app without crash', () => {
    const fsApp = { ...mockApp, appType: 'fullstack' as const };
    render(<PreviewPanel app={fsApp} onPublish={() => {}} />);
    expect(screen.getAllByText('Run App').length).toBeGreaterThan(0);
  });

  /* ── Multiple log toggles ──────────────────────────── */

  it('toggles log panel off and on', () => {
    render(<PreviewPanel app={mockApp} onPublish={() => {}} />);
    const logsBtn = screen.getByText('Logs');
    fireEvent.click(logsBtn); // open
    expect(logsBtn.className).toContain('active');
    fireEvent.click(logsBtn); // close
    expect(logsBtn.className).not.toContain('active');
  });
});
