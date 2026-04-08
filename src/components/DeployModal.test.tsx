// @vitest-environment happy-dom
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DeployModal from './DeployModal';

beforeEach(() => {
  window.deyad = {
    deployCheck: vi.fn().mockResolvedValue({ netlify: true, vercel: true, surge: false, railway: false, flyio: false }),
    deploy: vi.fn().mockResolvedValue({ success: true, url: 'https://example.netlify.app' }),
    deployFullstack: vi.fn().mockResolvedValue({ success: true, url: 'https://example.fly.dev' }),
    onDeployLog: vi.fn(() => () => {}),
    capacitorInit: vi.fn().mockResolvedValue({ success: true }),
    capacitorListDevices: vi.fn().mockResolvedValue({ success: true, devices: [] }),
    capacitorRun: vi.fn().mockResolvedValue({ success: true }),
    capacitorOpen: vi.fn().mockResolvedValue({ success: true }),
    capacitorLiveReload: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as DeyadAPI;
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
      expect(window.deyad.deployCheck).toHaveBeenCalled();
    });
  });

  it('shows checking state initially', () => {
    Object.assign(window.deyad, { deployCheck: vi.fn(() => new Promise(() => {})) }); // never resolves
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
    expect(window.deyad.onDeployLog).toHaveBeenCalled();
  });

  it('selects a provider and deploys frontend', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Vercel')).toBeTruthy());
    fireEvent.click(screen.getByText('Vercel'));
    fireEvent.click(screen.getByText('Deploy Now'));
    await waitFor(() => {
      expect(window.deyad.deploy).toHaveBeenCalledWith('app1', 'vercel');
    });
  });

  it('shows fullstack providers for fullstack apps', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="fullstack" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Railway')).toBeTruthy();
      expect(screen.getByText('Fly.io')).toBeTruthy();
    });
  });

  it('deploys fullstack with deployFullstack', async () => {
    Object.assign(window.deyad, {
      deployCheck: vi.fn().mockResolvedValue({ netlify: false, vercel: false, surge: false, railway: true, flyio: false }),
    });
    render(<DeployModal appId="app1" appName="Test" appType="fullstack" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Railway')).toBeTruthy());
    fireEvent.click(screen.getByText('Railway'));
    fireEvent.click(screen.getByText('Deploy Now'));
    await waitFor(() => {
      expect(window.deyad.deployFullstack).toHaveBeenCalledWith('app1', 'railway');
    });
  });

  it('shows deploy result on success', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Vercel')).toBeTruthy());
    fireEvent.click(screen.getByText('Vercel'));
    fireEvent.click(screen.getByText('Deploy Now'));
    await waitFor(() => {
      expect(screen.getByText(/Deployed successfully/)).toBeTruthy();
    });
  });

  it('shows deploy error on failure', async () => {
    Object.assign(window.deyad, {
      deploy: vi.fn().mockResolvedValue({ success: false, error: 'Auth required' }),
    });
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Vercel')).toBeTruthy());
    fireEvent.click(screen.getByText('Vercel'));
    fireEvent.click(screen.getByText('Deploy Now'));
    await waitFor(() => {
      expect(screen.getByText(/Auth required/)).toBeTruthy();
    });
  });

  it('shows install hint when no CLIs are available', async () => {
    Object.assign(window.deyad, {
      deployCheck: vi.fn().mockResolvedValue({ netlify: false, vercel: false, surge: false, railway: false, flyio: false }),
    });
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/No deploy CLIs detected/)).toBeTruthy();
    });
  });

  it('initializes Capacitor for mobile', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Vercel')).toBeTruthy());
    fireEvent.click(screen.getByText('Initialize'));
    await waitFor(() => {
      expect(window.deyad.capacitorInit).toHaveBeenCalledWith('app1');
    });
  });

  it('detects mobile devices', async () => {
    Object.assign(window.deyad, {
      capacitorListDevices: vi.fn().mockResolvedValue({ success: true, devices: [{ id: 'emu1', name: 'Pixel 6' }] }),
    });
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Vercel')).toBeTruthy());
    fireEvent.click(screen.getByText('Detect Devices'));
    await waitFor(() => {
      expect(window.deyad.capacitorListDevices).toHaveBeenCalled();
    });
  });

  it('closes overlay when clicking outside', async () => {
    const onClose = vi.fn();
    const { container } = render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={onClose} />);
    const overlay = container.querySelector('.modal-overlay');
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalled();
  });
});
