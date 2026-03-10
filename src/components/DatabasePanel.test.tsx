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
  dbProvider: 'postgresql' as const,
  dbPort: 15432,
  guiPort: 15050,
};

const simpleSchema = {
  tables: [
    { name: 'User', columns: ['id', 'name', 'email'] },
    { name: 'Post', columns: ['id', 'title', 'body'] },
  ],
};

describe('DatabasePanel', () => {
  beforeEach(() => {
    (window as any).deyad = {
      dbDescribe: vi.fn().mockResolvedValue(simpleSchema),
      portCheck: vi.fn().mockResolvedValue(true),
      getSettings: vi.fn().mockResolvedValue({ pgAdminEmail: 'admin@admin.com', pgAdminPassword: 'admin' }),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows message for non-fullstack app', () => {
    render(<DatabasePanel app={{ ...fullApp, appType: 'frontend' }} dbStatus="none" />);
    expect(screen.getByText(/only for full-stack apps/i)).toBeTruthy();
  });

  it('shows placeholder when DB stopped', () => {
    render(<DatabasePanel app={fullApp} dbStatus="stopped" />);
    expect(screen.getByText(/start the database/i)).toBeTruthy();
  });

  it('renders webview when DB is running', async () => {
    const { container } = render(<DatabasePanel app={fullApp} dbStatus="running" />);
    await waitFor(() => {
      const webview = container.querySelector('webview');
      expect(webview).toBeTruthy();
      expect(webview?.getAttribute('src')).toContain('15050');
    });
  });

  it('shows starting placeholder when port not ready', () => {
    (window as any).deyad.portCheck = vi.fn().mockResolvedValue(false);
    render(<DatabasePanel app={fullApp} dbStatus="running" />);
    expect(screen.getByText(/starting pgadmin/i)).toBeTruthy();
  });

  it('switches to schema view and shows tables', async () => {
    const { container } = render(<DatabasePanel app={fullApp} dbStatus="running" />);
    const schemaBtn = container.querySelector('.db-toolbar-tab:nth-child(2)');
    fireEvent.click(schemaBtn!);
    expect(await screen.findByText('User')).toBeTruthy();
    expect(screen.getByText('Post')).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });
});