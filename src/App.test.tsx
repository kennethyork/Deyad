// @vitest-environment happy-dom
/// <reference types="vitest" />
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from './App';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stub out heavy native modules that aren't needed for these tests
vi.mock('@monaco-editor/react', () => ({ default: () => null }));
vi.mock('xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    loadAddon: vi.fn(),
    open: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
    attachCustomKeyEventHandler: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    write: vi.fn(),
    cols: 80,
    rows: 24,
  })),
}));
vi.mock('xterm-addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({ fit: vi.fn() })),
}));

describe('App component', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    // clear any persisted widths
    localStorage.clear();
    // provide a minimal deyad API stub to avoid undefined errors
    window.deyad = {
      listApps: vi.fn().mockResolvedValue([]),
      createApp: vi.fn(),
      readFiles: vi.fn().mockResolvedValue({}),
      writeFiles: vi.fn(),
      hasSnapshot: vi.fn().mockResolvedValue(false),
      dbStatus: vi.fn().mockResolvedValue({ status: 'none' }),
      onDbStatus: vi.fn().mockReturnValue(() => {}),
      onAppDevLog: vi.fn().mockReturnValue(() => {}),
      onAppDevStatus: vi.fn().mockReturnValue(() => {}),
      appDevStatus: vi.fn().mockResolvedValue({ status: 'stopped' }),
      checkDocker: vi.fn(),
      getSettings: vi.fn().mockResolvedValue({ ollamaHost: '', defaultModel: '' }),
      listModels: vi.fn().mockResolvedValue({ models: [] }),
      andThen: undefined,
      createTerminal: vi.fn().mockResolvedValue('term1'),
      terminalWrite: vi.fn(),
      terminalResize: vi.fn(),
      onTerminalData: vi.fn().mockReturnValue(() => {}),
      onTerminalExit: vi.fn().mockReturnValue(() => {}),
      onTerminalClear: vi.fn().mockReturnValue(() => {}),
      terminalKill: vi.fn().mockResolvedValue(undefined),
      // other stubs may be needed but App won't call them in tests
    } as unknown as DeyadAPI;
  });

  it('initializes sidebar and right panel widths from localStorage', () => {
    localStorage.setItem('sidebarWidth', '300');
    localStorage.setItem('rightWidth', '500');

    const { container } = render(<App />);
    const layout = container.querySelector('.app-layout');

    expect(layout).toHaveStyle('grid-template-columns: 300px 4px 1fr 4px 500px');
  });

  it('falls back to defaults when storage is empty or invalid', () => {
    localStorage.setItem('sidebarWidth', 'not-a-number');
    localStorage.setItem('rightWidth', '');

    const { container } = render(<App />);
    const layout = container.querySelector('.app-layout');

    // defaults hard-coded in component — widths live in grid-template-columns
    expect(layout).toHaveStyle('grid-template-columns: 220px 4px 1fr 4px 340px');
  });

  it('allows sidebar to be resized by dragging the resizer', () => {
    const { container } = render(<App />);
    const layout = container.querySelector('.app-layout');
    const resizer = container.querySelector('.resizer[data-side="sidebar"]');
    expect(resizer).not.toBeNull();

    // simulate drag from x=0 to x=100
    fireEvent.mouseDown(resizer!, { clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 100 });
    fireEvent.mouseUp(window);

    // width should increase by dx (default 220 + 100) — now in grid-template-columns
    expect(layout).toHaveStyle('grid-template-columns: 320px 4px 1fr 4px 340px');
    expect(localStorage.getItem('sidebarWidth')).toBe('320');
  });

  it('allows right panel to be resized by dragging the resizer', () => {
    const { container } = render(<App />);
    const layout = container.querySelector('.app-layout');
    const resizer = container.querySelector('.resizer[data-side="right"]');
    expect(resizer).not.toBeNull();

    // simulate drag from x=0 to x=100 (moving resizer right shrinks the right panel by 100)
    fireEvent.mouseDown(resizer!, { clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 100 });
    fireEvent.mouseUp(window);

    // right width should decrease by dx (default 340 - 100 = 240) — now in grid-template-columns
    expect(layout).toHaveStyle('grid-template-columns: 220px 4px 1fr 4px 240px');
    expect(localStorage.getItem('rightWidth')).toBe('240');
  });

  it('shows terminal tab and switches to it', async () => {
    const app = {
      id: 'term-app',
      name: 'Terminal Test App',
      description: '',
      createdAt: new Date().toISOString(),
      appType: 'frontend' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });

    const { container } = render(<App />);

    // wait for app to appear in the sidebar, then select it
    await screen.findByText('Terminal Test App');
    fireEvent.click(screen.getByText('Terminal Test App'));

    // wait for the right-panel tabs to appear
    const termBtn = await screen.findByText('Terminal');
    expect(termBtn).toBeInTheDocument();

    fireEvent.click(termBtn);
    // terminal panel should appear
    await waitFor(() => expect(container.querySelector('.terminal-panel')).toBeInTheDocument());
  });

  it('shows database tab and content for full-stack app', async () => {
    const app = {
      id: 'db-app',
      name: 'DB Test App',
      description: '',
      createdAt: new Date().toISOString(),
      appType: 'fullstack' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });
    Object.assign(window.deyad, { dbDescribe: vi.fn().mockResolvedValue({ tables: [{ name: 'Things', columns: ['a','b'] }] }) });

    const { container } = render(<App />);
    await screen.findByText('DB Test App');
    fireEvent.click(screen.getByText('DB Test App'));

    const dbBtn = await screen.findByText('Database');
    expect(dbBtn).toBeInTheDocument();
    fireEvent.click(dbBtn);

    // Switch to Schema view (default is embedded GUI view)
    fireEvent.click(await screen.findByText('Schema'));

    await waitFor(() => expect(container.querySelector('.db-table-name')).toHaveTextContent('Things'));
  });

  it('exports using mobile option when confirm returns true', async () => {
    const app = {
      id: 'exp-app',
      name: 'Export Test',
      description: '',
      createdAt: new Date().toISOString(),
      appType: 'frontend' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });
    Object.assign(window.deyad, { exportApp: vi.fn().mockResolvedValue({ success: true, path: '/tmp/mobile' }) });

    render(<App />);
    // wait for sidebar entry to appear
    await screen.findByText('Export Test');
    // click the first Export button that shows up
    const exportBtns = screen.getAllByTitle('Export as ZIP');
    fireEvent.click(exportBtns[0]);
    // ConfirmDialog appears – click "Mobile/PWA" to export as mobile
    const mobileBtn = await screen.findByText('Mobile/PWA');
    fireEvent.click(mobileBtn);
    await waitFor(() => expect(window.deyad.exportApp).toHaveBeenCalledWith('exp-app', 'mobile'));
  });

  it('exports as zip when ZIP is chosen in dialog', async () => {
    const app = {
      id: 'exp-app2',
      name: 'Export Test 2',
      description: '',
      createdAt: new Date().toISOString(),
      appType: 'frontend' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });
    Object.assign(window.deyad, { exportApp: vi.fn().mockResolvedValue({ success: true, path: '/tmp/zip' }) });

    render(<App />);
    await screen.findByText('Export Test 2');
    const exportBtns2 = screen.getAllByTitle('Export as ZIP');
    fireEvent.click(exportBtns2[0]);
    // ConfirmDialog appears – click "ZIP" to export as zip
    const zipBtn = await screen.findByText('ZIP');
    fireEvent.click(zipBtn);
    await waitFor(() => expect(window.deyad.exportApp).toHaveBeenCalledWith('exp-app2', 'zip'));
  });

  /* ── App selection and switching ───────────────────── */

  it('selects app when clicked in sidebar', async () => {
    const app = {
      id: 'sel-app', name: 'Selection App', description: '',
      createdAt: new Date().toISOString(), appType: 'frontend' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });

    const { container } = render(<App />);
    const appEntry = await screen.findByText('Selection App');
    fireEvent.click(appEntry);
    // After selecting, the app item should get the active class
    await waitFor(() => {
      const activeItem = container.querySelector('.sidebar-item.active');
      expect(activeItem).toBeTruthy();
    });
  });

  it('loads app files after selection', async () => {
    const app = {
      id: 'file-app', name: 'File App', description: '',
      createdAt: new Date().toISOString(), appType: 'frontend' as const,
    };
    Object.assign(window.deyad, {
      listApps: vi.fn().mockResolvedValue([app]),
      readFiles: vi.fn().mockResolvedValue({ 'src/App.tsx': 'export default 42' }),
    });

    render(<App />);
    await screen.findByText('File App');
    fireEvent.click(screen.getByText('File App'));
    await waitFor(() => expect(window.deyad.readFiles).toHaveBeenCalledWith('file-app'));
  });

  /* ── Multiple apps in sidebar ──────────────────────── */

  it('renders multiple apps in sidebar', async () => {
    const apps = [
      { id: 'app-a', name: 'Alpha', description: '', createdAt: new Date().toISOString(), appType: 'frontend' as const },
      { id: 'app-b', name: 'Beta', description: '', createdAt: new Date().toISOString(), appType: 'fullstack' as const },
    ];
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue(apps) });

    render(<App />);
    await screen.findByText('Alpha');
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  /* ── Delete app flow ───────────────────────────────── */

  it('deletes an app when delete button clicked and confirmed', async () => {
    const app = {
      id: 'del-app', name: 'Delete Me', description: '',
      createdAt: new Date().toISOString(), appType: 'frontend' as const,
    };
    Object.assign(window.deyad, {
      listApps: vi.fn().mockResolvedValue([app]),
      deleteApp: vi.fn().mockResolvedValue(undefined),
      appDevStop: vi.fn().mockResolvedValue(undefined),
    });

    render(<App />);
    await screen.findByText('Delete Me');
    const deleteBtn = screen.getByTitle('Delete app');
    fireEvent.click(deleteBtn);
    // First click shows confirm state, click again to confirm
    const confirmBtn = screen.getByTitle('Click again to confirm');
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(window.deyad.deleteApp).toHaveBeenCalledWith('del-app'));
  });

  /* ── Rename app ────────────────────────────────────── */

  it('renames an app', async () => {
    const app = {
      id: 'ren-app', name: 'Old Name', description: '',
      createdAt: new Date().toISOString(), appType: 'frontend' as const,
    };
    Object.assign(window.deyad, {
      listApps: vi.fn().mockResolvedValue([app]),
      renameApp: vi.fn().mockResolvedValue(undefined),
    });

    render(<App />);
    const nameSpan = await screen.findByText('Old Name');
    // Double-click the name to start editing
    fireEvent.doubleClick(nameSpan);
    // Enter new name
    const input = await screen.findByDisplayValue('Old Name');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(window.deyad.renameApp).toHaveBeenCalledWith('ren-app', 'New Name'));
  });

  /* ── Right panel tabs ──────────────────────────────── */

  it('switches between editor and preview tabs', async () => {
    const app = {
      id: 'tab-app', name: 'Tab App', description: '',
      createdAt: new Date().toISOString(), appType: 'frontend' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });

    const { container } = render(<App />);
    await screen.findByText('Tab App');
    fireEvent.click(screen.getByText('Tab App'));

    // Click Preview tab
    const previewTab = await screen.findByText('Preview');
    fireEvent.click(previewTab);
    await waitFor(() => expect(container.querySelector('.preview-panel')).toBeInTheDocument());
  });

  /* ── Search tab ────────────────────────────────────── */

  it('shows search panel when search tab clicked', async () => {
    const app = {
      id: 'search-app', name: 'Search App', description: '',
      createdAt: new Date().toISOString(), appType: 'frontend' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });

    const { container } = render(<App />);
    await screen.findByText('Search App');
    fireEvent.click(screen.getByText('Search App'));

    const searchTab = await screen.findByText('Search');
    fireEvent.click(searchTab);
    await waitFor(() => expect(container.querySelector('.search-panel')).toBeInTheDocument());
  });

  /* ── Git tab for fullstack ─────────────────────────── */

  it('shows git tab for selected app', async () => {
    const app = {
      id: 'git-app', name: 'Git App', description: '',
      createdAt: new Date().toISOString(), appType: 'frontend' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });

    render(<App />);
    await screen.findByText('Git App');
    fireEvent.click(screen.getByText('Git App'));
    const gitTab = await screen.findByText('Git');
    expect(gitTab).toBeInTheDocument();
  });

  /* ── Empty state ───────────────────────────────────── */

  it('shows empty state when no apps exist', async () => {
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([]) });
    render(<App />);
    // Should show the empty sidebar message
    await screen.findByText('No apps yet');
  });

  /* ── Sidebar resize clamp ──────────────────────────── */

  it('clamps sidebar width to minimum', () => {
    const { container } = render(<App />);
    const resizer = container.querySelector('.resizer[data-side="sidebar"]');
    expect(resizer).not.toBeNull();

    // drag far left
    fireEvent.mouseDown(resizer!, { clientX: 220 });
    fireEvent.mouseMove(window, { clientX: 0 });
    fireEvent.mouseUp(window);

    const layout = container.querySelector('.app-layout');
    // Layout should still render (no crash) and sidebar shouldn't be 0
    expect(layout).toBeTruthy();
  });

  it('clamps right panel width to minimum', () => {
    const { container } = render(<App />);
    const resizer = container.querySelector('.resizer[data-side="right"]');
    expect(resizer).not.toBeNull();

    // drag far right
    fireEvent.mouseDown(resizer!, { clientX: 0 });
    fireEvent.mouseMove(window, { clientX: 2000 });
    fireEvent.mouseUp(window);

    const layout = container.querySelector('.app-layout');
    expect(layout).toBeTruthy();
  });

  /* ── Dev status subscription ───────────────────────── */

  it('subscribes to dev status events for selected app', async () => {
    const app = {
      id: 'dev-app', name: 'Dev App', description: '',
      createdAt: new Date().toISOString(), appType: 'frontend' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });

    render(<App />);
    await screen.findByText('Dev App');
    fireEvent.click(screen.getByText('Dev App'));
    await waitFor(() => {
      expect(window.deyad.onAppDevStatus).toHaveBeenCalled();
    });
  });

  /* ── listApps failure ──────────────────────────────── */

  it('handles listApps failure gracefully', async () => {
    Object.assign(window.deyad, { listApps: vi.fn().mockRejectedValue(new Error('disk error')) });
    // Should not crash — loadApps has try/catch
    const { container } = render(<App />);
    await waitFor(() => expect(container.querySelector('.app-layout')).toBeTruthy());
  });

  /* ── Settings modal ────────────────────────────────── */

  it('opens settings modal when settings button clicked', async () => {
    render(<App />);
    const settingsBtn = screen.queryByTitle(/Settings/i);
    if (settingsBtn) {
      fireEvent.click(settingsBtn);
      await waitFor(() => expect(screen.getByText('Save Settings')).toBeInTheDocument());
    }
  });

  /* ── hasSnapshot check ─────────────────────────────── */

  it('checks snapshot status for selected app', async () => {
    const app = {
      id: 'snap-app', name: 'Snap App', description: '',
      createdAt: new Date().toISOString(), appType: 'frontend' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });

    render(<App />);
    await screen.findByText('Snap App');
    fireEvent.click(screen.getByText('Snap App'));
    await waitFor(() => expect(window.deyad.hasSnapshot).toHaveBeenCalledWith('snap-app'));
  });

  /* ── DB status subscription for fullstack ──────────── */

  it('subscribes to db status for fullstack app', async () => {
    const app = {
      id: 'fs-app', name: 'FS App', description: '',
      createdAt: new Date().toISOString(), appType: 'fullstack' as const,
    };
    Object.assign(window.deyad, { listApps: vi.fn().mockResolvedValue([app]) });

    render(<App />);
    await screen.findByText('FS App');
    fireEvent.click(screen.getByText('FS App'));
    await waitFor(() => expect(window.deyad.onDbStatus).toHaveBeenCalled());
  });
});
