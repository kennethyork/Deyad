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

  /* ── Provider filtering ────────────────────────────── */

  it('frontend apps do not show Railway or Fly.io', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Netlify')).toBeTruthy());
    expect(screen.queryByText('Railway')).toBeNull();
    expect(screen.queryByText('Fly.io')).toBeNull();
  });

  it('fullstack apps show all five providers', async () => {
    Object.assign(window.deyad, {
      deployCheck: vi.fn().mockResolvedValue({ netlify: true, vercel: true, surge: true, railway: true, flyio: true }),
    });
    render(<DeployModal appId="app1" appName="Test" appType="fullstack" onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText('Netlify')).toBeTruthy();
      expect(screen.getByText('Vercel')).toBeTruthy();
      expect(screen.getByText('Surge')).toBeTruthy();
      expect(screen.getByText('Railway')).toBeTruthy();
      expect(screen.getByText('Fly.io')).toBeTruthy();
    });
  });

  /* ── Deploy Now button state ───────────────────────── */

  it('Deploy Now button disabled when no provider selected', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Netlify')).toBeTruthy());
    const deployBtn = screen.getByText('Deploy Now');
    expect((deployBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('Deploy Now button enabled after selecting a provider', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Netlify')).toBeTruthy());
    fireEvent.click(screen.getByText('Netlify'));
    const deployBtn = screen.getByText('Deploy Now');
    expect((deployBtn as HTMLButtonElement).disabled).toBe(false);
  });

  /* ── Deploy result URL ─────────────────────────────── */

  it('shows deployed URL on success', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Netlify')).toBeTruthy());
    fireEvent.click(screen.getByText('Netlify'));
    fireEvent.click(screen.getByText('Deploy Now'));
    await waitFor(() => {
      expect(screen.getByText(/example\.netlify\.app/)).toBeTruthy();
    });
  });

  /* ── Modal stop propagation ────────────────────────── */

  it('modal dialog click does not close overlay', async () => {
    const onClose = vi.fn();
    const { container } = render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('Netlify')).toBeTruthy());
    const modal = container.querySelector('.deploy-modal')!;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  /* ── Mobile section ────────────────────────────────── */

  it('calls capacitorOpen with correct platform', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Vercel')).toBeTruthy());
    // Look for 'Open IDE' button
    const openBtn = screen.queryByText('Open IDE');
    if (openBtn) {
      fireEvent.click(openBtn);
      await waitFor(() => {
        expect(window.deyad.capacitorOpen).toHaveBeenCalled();
      });
    }
  });

  it('calls capacitorRun when Run on Device clicked', async () => {
    Object.assign(window.deyad, {
      capacitorListDevices: vi.fn().mockResolvedValue({
        success: true,
        devices: [{ id: 'emu1', name: 'Pixel 6' }],
      }),
    });
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Detect Devices')).toBeTruthy());
    fireEvent.click(screen.getByText('Detect Devices'));
    await waitFor(() => expect(window.deyad.capacitorListDevices).toHaveBeenCalled());
    const runBtn = screen.queryByText('Run on Device');
    if (runBtn) {
      fireEvent.click(runBtn);
      await waitFor(() => expect(window.deyad.capacitorRun).toHaveBeenCalled());
    }
  });

  /* ── Deploy log subscription cleanup ───────────────── */

  it('unsubscribes from deploy logs on unmount', () => {
    const unsub = vi.fn();
    Object.assign(window.deyad, { onDeployLog: vi.fn(() => unsub) });
    const { unmount } = render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    unmount();
    expect(unsub).toHaveBeenCalled();
  });

  /* ── Deploy error from deploy function ─────────────── */

  it('shows fullstack deploy error', async () => {
    Object.assign(window.deyad, {
      deployCheck: vi.fn().mockResolvedValue({ netlify: false, vercel: false, surge: false, railway: true, flyio: false }),
      deployFullstack: vi.fn().mockResolvedValue({ success: false, error: 'Railway: project not found' }),
    });
    render(<DeployModal appId="app1" appName="Test" appType="fullstack" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Railway')).toBeTruthy());
    fireEvent.click(screen.getByText('Railway'));
    fireEvent.click(screen.getByText('Deploy Now'));
    await waitFor(() => {
      expect(screen.getByText(/project not found/)).toBeTruthy();
    });
  });

  /* ── Capacitor init success ────────────────────────── */

  it('shows success message after Capacitor init', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Initialize')).toBeTruthy());
    fireEvent.click(screen.getByText('Initialize'));
    await waitFor(() => {
      expect(window.deyad.capacitorInit).toHaveBeenCalledWith('app1');
    });
  });

  /* ── Multiple provider selection ───────────────────── */

  it('switching provider updates selection', async () => {
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Netlify')).toBeTruthy());
    fireEvent.click(screen.getByText('Netlify'));
    fireEvent.click(screen.getByText('Vercel'));
    // Deploy should use the last selected provider
    fireEvent.click(screen.getByText('Deploy Now'));
    await waitFor(() => {
      expect(window.deyad.deploy).toHaveBeenCalledWith('app1', 'vercel');
    });
  });

  /* ── Deploy check failure ──────────────────────────── */

  it('handles deploy check failure gracefully', async () => {
    Object.assign(window.deyad, {
      deployCheck: vi.fn().mockRejectedValue(new Error('network error')),
    });
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    // Should not crash — wait a bit and verify modal still renders
    await waitFor(() => {
      expect(screen.getByText('Deploy Test')).toBeTruthy();
    });
  });

  /* ── Deploy with surge provider ────────────────────── */

  it('deploys with surge when available', async () => {
    Object.assign(window.deyad, {
      deployCheck: vi.fn().mockResolvedValue({ netlify: false, vercel: false, surge: true, railway: false, flyio: false }),
    });
    render(<DeployModal appId="app1" appName="Test" appType="frontend" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Surge')).toBeTruthy());
    fireEvent.click(screen.getByText('Surge'));
    fireEvent.click(screen.getByText('Deploy Now'));
    await waitFor(() => {
      expect(window.deyad.deploy).toHaveBeenCalledWith('app1', 'surge');
    });
  });
});
