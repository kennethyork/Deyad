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
    (window as any).dyad = {
      dbDescribe: vi.fn().mockResolvedValue(simpleSchema),
      portCheck: vi.fn().mockResolvedValue(true),
    };
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
    (window as any).dyad.portCheck = vi.fn().mockResolvedValue(false);
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
