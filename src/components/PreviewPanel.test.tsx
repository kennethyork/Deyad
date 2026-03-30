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
  (window as any).dyad = {
    onAppDevLog: vi.fn().mockReturnValue(() => {}),
    onAppDevStatus: vi.fn().mockReturnValue(() => {}),
    appDevStart: vi.fn().mockResolvedValue({ success: true }),
    appDevStop: vi.fn().mockResolvedValue(undefined),
    appDevStatus: vi.fn().mockResolvedValue({ status: 'stopped' }),
    getSettings: vi.fn().mockResolvedValue({}),
  };
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
      expect(window.dyad.appDevStart).toHaveBeenCalledWith('app1');
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
    expect(window.dyad.onAppDevLog).toHaveBeenCalled();
    expect(window.dyad.onAppDevStatus).toHaveBeenCalled();
  });
});
