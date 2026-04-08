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
});
