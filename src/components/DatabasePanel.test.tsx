// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import DatabasePanel from './DatabasePanel';

const fullApp = {
  id: 'fs1',
  name: 'FullStack',
  description: '',
  createdAt: new Date().toISOString(),
  appType: 'fullstack' as const,
  dbProvider: 'sqlite' as const,
  guiPort: 15555,
};

const simpleSchema = {
  tables: [
    { name: 'User', columns: ['id', 'name', 'email'] },
    { name: 'Post', columns: ['id', 'title', 'body'] },
  ],
};

describe('DatabasePanel', () => {
  beforeEach(() => {
    window.deyad = {
      dbDescribe: vi.fn().mockResolvedValue(simpleSchema),
      portCheck: vi.fn().mockResolvedValue(true),
    } as unknown as DeyadAPI;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows message for non-fullstack app', () => {
    render(<DatabasePanel app={{ ...fullApp, appType: 'frontend' }} dbStatus="none" onDbToggle={vi.fn()} />);
    expect(screen.getByText(/only for full-stack apps/i)).toBeTruthy();
  });

  it('shows placeholder when DB stopped', () => {
    render(<DatabasePanel app={fullApp} dbStatus="stopped" onDbToggle={vi.fn()} />);
    expect(screen.getByText(/start the db viewer/i)).toBeTruthy();
  });

  it('renders webview when DB is running', async () => {
    const { container } = render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={vi.fn()} />);
    await waitFor(() => {
      const webview = container.querySelector('webview');
      expect(webview).toBeTruthy();
      expect(webview?.getAttribute('src')).toContain('15555');
    });
  });

  it('shows starting placeholder when port not ready', () => {
    Object.assign(window.deyad, { portCheck: vi.fn().mockResolvedValue(false) });
    render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={vi.fn()} />);
    expect(screen.getByText(/starting prisma studio/i)).toBeTruthy();
  });

  it('switches to schema view and shows tables', async () => {
    const { container } = render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={vi.fn()} />);
    const schemaBtn = container.querySelector('.db-toolbar-tab:nth-child(2)');
    fireEvent.click(schemaBtn!);
    expect(await screen.findByText('User')).toBeTruthy();
    expect(screen.getByText('Post')).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });
});

describe('DatabasePanel — toggle button', () => {
  beforeEach(() => {
    window.deyad = {
      dbDescribe: vi.fn().mockResolvedValue(simpleSchema),
      portCheck: vi.fn().mockResolvedValue(true),
    } as unknown as DeyadAPI;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('Start button calls onDbToggle when stopped', () => {
    const onDbToggle = vi.fn();
    render(<DatabasePanel app={fullApp} dbStatus="stopped" onDbToggle={onDbToggle} />);
    fireEvent.click(screen.getByText('▶ Start'));
    expect(onDbToggle).toHaveBeenCalledOnce();
  });

  it('Stop button calls onDbToggle when running', async () => {
    const onDbToggle = vi.fn();
    render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={onDbToggle} />);
    fireEvent.click(screen.getByText('⏹ Stop'));
    expect(onDbToggle).toHaveBeenCalledOnce();
  });

  it('no Start/Stop button when dbStatus is none', () => {
    const { container } = render(<DatabasePanel app={{ ...fullApp, appType: 'frontend' }} dbStatus="none" onDbToggle={vi.fn()} />);
    expect(container.querySelector('.btn-db')).toBeFalsy();
  });
});

describe('DatabasePanel — status display', () => {
  beforeEach(() => {
    window.deyad = {
      dbDescribe: vi.fn().mockResolvedValue(simpleSchema),
      portCheck: vi.fn().mockResolvedValue(true),
    } as unknown as DeyadAPI;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('shows "Running" when status is running', () => {
    render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={vi.fn()} />);
    expect(screen.getByText('Running')).toBeTruthy();
  });

  it('shows "Stopped" when status is stopped', () => {
    render(<DatabasePanel app={fullApp} dbStatus="stopped" onDbToggle={vi.fn()} />);
    expect(screen.getByText('Stopped')).toBeTruthy();
  });
});

describe('DatabasePanel — default guiPort', () => {
  beforeEach(() => {
    window.deyad = {
      dbDescribe: vi.fn().mockResolvedValue(simpleSchema),
      portCheck: vi.fn().mockResolvedValue(true),
    } as unknown as DeyadAPI;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('defaults to port 5555 when app has no guiPort', async () => {
    const appNoPort = { ...fullApp };
    delete (appNoPort as Record<string, unknown>).guiPort;
    const { container } = render(<DatabasePanel app={appNoPort} dbStatus="running" onDbToggle={vi.fn()} />);
    await waitFor(() => {
      const webview = container.querySelector('webview');
      expect(webview?.getAttribute('src')).toContain('5555');
    });
  });
});

describe('DatabasePanel — schema states', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('shows loading when schema is being fetched', async () => {
    let resolveDescribe: (val: unknown) => void;
    window.deyad = {
      dbDescribe: vi.fn().mockImplementation(() => new Promise(r => { resolveDescribe = r; })),
      portCheck: vi.fn().mockResolvedValue(true),
    } as unknown as DeyadAPI;
    const { container } = render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={vi.fn()} />);
    const schemaBtn = container.querySelector('.db-toolbar-tab:nth-child(2)');
    fireEvent.click(schemaBtn!);
    expect(screen.getByText(/Loading schema/)).toBeTruthy();
    resolveDescribe!({ tables: [] });
  });

  it('shows error when dbDescribe fails', async () => {
    window.deyad = {
      dbDescribe: vi.fn().mockRejectedValue(new Error('no db')),
      portCheck: vi.fn().mockResolvedValue(true),
    } as unknown as DeyadAPI;
    const { container } = render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={vi.fn()} />);
    const schemaBtn = container.querySelector('.db-toolbar-tab:nth-child(2)');
    fireEvent.click(schemaBtn!);
    await waitFor(() => expect(screen.getByText(/Error: no db/)).toBeTruthy());
  });

  it('shows empty message when no tables', async () => {
    window.deyad = {
      dbDescribe: vi.fn().mockResolvedValue({ tables: [] }),
      portCheck: vi.fn().mockResolvedValue(true),
    } as unknown as DeyadAPI;
    const { container } = render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={vi.fn()} />);
    const schemaBtn = container.querySelector('.db-toolbar-tab:nth-child(2)');
    fireEvent.click(schemaBtn!);
    await waitFor(() => expect(screen.getByText(/No tables found/)).toBeTruthy());
  });

  it('renders column list items in schema', async () => {
    window.deyad = {
      dbDescribe: vi.fn().mockResolvedValue(simpleSchema),
      portCheck: vi.fn().mockResolvedValue(true),
    } as unknown as DeyadAPI;
    const { container } = render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={vi.fn()} />);
    const schemaBtn = container.querySelector('.db-toolbar-tab:nth-child(2)');
    fireEvent.click(schemaBtn!);
    await waitFor(() => {
      expect(screen.getAllByText('id').length).toBeGreaterThan(0);
      expect(screen.getByText('name')).toBeTruthy();
      expect(screen.getByText('email')).toBeTruthy();
    });
  });
});

describe('DatabasePanel — tab active class', () => {
  beforeEach(() => {
    window.deyad = {
      dbDescribe: vi.fn().mockResolvedValue(simpleSchema),
      portCheck: vi.fn().mockResolvedValue(true),
    } as unknown as DeyadAPI;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('GUI tab is active by default', () => {
    const { container } = render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={vi.fn()} />);
    const guiBtn = container.querySelector('.db-toolbar-tab:nth-child(1)');
    expect(guiBtn?.classList.contains('active')).toBe(true);
  });

  it('Schema tab gets active class when clicked', () => {
    const { container } = render(<DatabasePanel app={fullApp} dbStatus="running" onDbToggle={vi.fn()} />);
    const schemaBtn = container.querySelector('.db-toolbar-tab:nth-child(2)')!;
    fireEvent.click(schemaBtn);
    expect(schemaBtn.classList.contains('active')).toBe(true);
    const guiBtn = container.querySelector('.db-toolbar-tab:nth-child(1)');
    expect(guiBtn?.classList.contains('active')).toBe(false);
  });
});

describe('DatabasePanel — placeholder large button', () => {
  beforeEach(() => {
    window.deyad = {
      dbDescribe: vi.fn().mockResolvedValue(simpleSchema),
      portCheck: vi.fn().mockResolvedValue(true),
    } as unknown as DeyadAPI;
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('Start DB Viewer placeholder button calls onDbToggle', () => {
    const onDbToggle = vi.fn();
    render(<DatabasePanel app={fullApp} dbStatus="stopped" onDbToggle={onDbToggle} />);
    fireEvent.click(screen.getByText(/Start DB Viewer/));
    expect(onDbToggle).toHaveBeenCalledOnce();
  });
});
