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
      dbTables: vi.fn().mockResolvedValue(['User', 'Post']),
      dbQuery: vi.fn().mockResolvedValue([
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]),
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows message for non-fullstack app', () => {
    render(<DatabasePanel app={{ ...fullApp, appType: 'frontend' }} />);
    expect(screen.getByText(/only for full-stack apps/i)).toBeTruthy();
  });

  it('shows table list from SQLite database', async () => {
    render(<DatabasePanel app={fullApp} />);
    await waitFor(() => {
      expect(screen.getAllByText('User').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Post').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('loads rows when a table is selected', async () => {
    render(<DatabasePanel app={fullApp} />);
    await waitFor(() => expect(screen.getAllByText('User').length).toBeGreaterThanOrEqual(1));
    // First table is auto-selected, rows should load
    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeTruthy();
      expect(screen.getByText('Bob')).toBeTruthy();
    });
  });

  it('shows placeholder when no database exists', async () => {
    (window as any).deyad.dbTables = vi.fn().mockResolvedValue([]);
    (window as any).deyad.dbDescribe = vi.fn().mockResolvedValue({ tables: [] });
    render(<DatabasePanel app={fullApp} />);
    await waitFor(() => {
      expect(screen.getByText(/database not created yet/i)).toBeTruthy();
    });
  });

  it('switches to schema view and shows tables', async () => {
    const { container } = render(<DatabasePanel app={fullApp} />);
    const schemaBtn = container.querySelector('.db-toolbar-tab:nth-child(2)');
    fireEvent.click(schemaBtn!);
    expect(await screen.findByText('User')).toBeTruthy();
    expect(screen.getByText('Post')).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });
});