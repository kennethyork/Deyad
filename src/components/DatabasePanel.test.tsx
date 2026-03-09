// @vitest-environment happy-dom
// @ts-nocheck
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import DatabasePanel from './DatabasePanel';

const fullApp = {
  id: 'fs1',
  name: 'FullStack',
  description: '',
  createdAt: new Date().toISOString(),
  appType: 'fullstack' as const,
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
    };
  });

  it('renders table list for fullstack app', async () => {
    render(<DatabasePanel app={fullApp} />);
    expect(await screen.findByText('User')).toBeTruthy();
    expect(screen.getByText('Post')).toBeTruthy();
    // at least one column should be visible
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('shows message for non-fullstack app', () => {
    render(<DatabasePanel app={{ ...fullApp, appType: 'frontend' }} />);
    expect(screen.getByText(/only for full-stack apps/i)).toBeTruthy();
  });
});