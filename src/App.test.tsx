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
    (window as any).deyad = {
      listApps: vi.fn().mockResolvedValue([]),
      createApp: vi.fn(),
      readFiles: vi.fn().mockResolvedValue({}),
      writeFiles: vi.fn(),
      hasSnapshot: vi.fn().mockResolvedValue(false),
      onAppDevLog: vi.fn().mockReturnValue(() => {}),
      onAppDevStatus: vi.fn().mockReturnValue(() => {}),
      appDevStatus: vi.fn().mockResolvedValue({ status: 'stopped' }),
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
      dbTables: vi.fn().mockResolvedValue([]),
      dbQuery: vi.fn().mockResolvedValue([]),
      dbDescribe: vi.fn().mockResolvedValue({ tables: [] }),
      listPlugins: vi.fn().mockResolvedValue([]),
      // other stubs may be needed but App won't call them in tests
    } as any;
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
    (window as any).deyad.listApps = vi.fn().mockResolvedValue([app]);

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
    (window as any).deyad.listApps = vi.fn().mockResolvedValue([app]);
    (window as any).deyad.dbDescribe = vi.fn().mockResolvedValue({ tables: [{ name: 'Things', columns: ['a','b'] }] });

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
    (window as any).deyad.listApps = vi.fn().mockResolvedValue([app]);
    (window as any).deyad.exportApp = vi.fn().mockResolvedValue({ success: true, path: '/tmp/mobile' });

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
    (window as any).deyad.listApps = vi.fn().mockResolvedValue([app]);
    (window as any).deyad.exportApp = vi.fn().mockResolvedValue({ success: true, path: '/tmp/zip' });

    render(<App />);
    await screen.findByText('Export Test 2');
    const exportBtns2 = screen.getAllByTitle('Export as ZIP');
    fireEvent.click(exportBtns2[0]);
    // ConfirmDialog appears – click "ZIP" to export as zip
    const zipBtn = await screen.findByText('ZIP');
    fireEvent.click(zipBtn);
    await waitFor(() => expect(window.deyad.exportApp).toHaveBeenCalledWith('exp-app2', 'zip'));
  });
});
