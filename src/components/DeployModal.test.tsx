// @vitest-environment happy-dom
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DeployModal from './DeployModal';

beforeEach(() => {
  (window as any).dyad = {
    deployCheck: vi.fn().mockResolvedValue({ netlify: true, vercel: true, surge: false, railway: false, flyio: false }),
    deploy: vi.fn().mockResolvedValue({ success: true, url: 'https://example.netlify.app' }),
    deployFullstack: vi.fn().mockResolvedValue({ success: true, url: 'https://example.fly.dev' }),
    onDeployLog: vi.fn(() => () => {}),
    capacitorInit: vi.fn().mockResolvedValue({ success: true }),
    capacitorListDevices: vi.fn().mockResolvedValue({ success: true, devices: [] }),
    capacitorRun: vi.fn().mockResolvedValue({ success: true }),
    capacitorOpen: vi.fn().mockResolvedValue({ success: true }),
    capacitorLiveReload: vi.fn().mockResolvedValue({ success: true }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DeployModal', () => {
  it('renders deploy modal with app name', async () => {
    render(<DeployModal appId="app1" appName="My App" appType="frontend" onClose={() => {}} />);
    expect(screen.getByText('Deploy My App')).toBeTruthy();
  });

  it('checks CLI availability on mount', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => {
      expect(window.dyad.deployCheck).toHaveBeenCalled();
    });
  });

  it('shows checking state initially', () => {
    (window as any).dyad.deployCheck = vi.fn(() => new Promise(() => {})); // never resolves
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    expect(screen.getByText(/checking/i)).toBeTruthy();
  });

  it('shows providers after check completes', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Vercel')).toBeTruthy();
      expect(screen.getByText('Netlify')).toBeTruthy();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Vercel')).toBeTruthy());
    screen.getByText('×').click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('subscribes to deploy logs on mount', () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    expect(window.dyad.onDeployLog).toHaveBeenCalled();
  });
});
