// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import Sidebar from './Sidebar';
import type { AppProject } from '../App';

const makeApp = (overrides: Partial<AppProject> = {}): AppProject => ({
  id: 'test-1',
  name: 'Test App',
  description: 'A test app',
  createdAt: new Date().toISOString(),
  appType: 'frontend',
  ...overrides,
});

describe('Sidebar', () => {
  const defaults = {
    apps: [] as AppProject[],
    selectedApp: null as AppProject | null,
    onSelectApp: vi.fn(),
    onNewApp: vi.fn(),
    onDeleteApp: vi.fn(),
    onRenameApp: vi.fn(),
    onDuplicateApp: vi.fn(),
    onExportApp: vi.fn(),
    onDeployApp: vi.fn(),
    onImportApp: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenTaskQueue: vi.fn(),
    onOpenVersionHistory: vi.fn(),
    activeTasks: 0,
  };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders Deyad logo and buttons', () => {
    render(<Sidebar {...defaults} />);
    expect(screen.getByText('Deyad')).toBeTruthy();
    expect(screen.getByText('Import')).toBeTruthy();
    expect(screen.getByText('+')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('shows empty state when no apps', () => {
    render(<Sidebar {...defaults} />);
    expect(screen.getByText('No apps yet')).toBeTruthy();
  });

  it('lists apps', () => {
    const apps = [makeApp({ id: '1', name: 'Alpha' }), makeApp({ id: '2', name: 'Beta' })];
    render(<Sidebar {...defaults} apps={apps} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('calls onSelectApp when an app is clicked', () => {
    const app = makeApp();
    render(<Sidebar {...defaults} apps={[app]} />);
    fireEvent.click(screen.getByText('Test App'));
    expect(defaults.onSelectApp).toHaveBeenCalledWith(app);
  });

  it('calls onNewApp when + is clicked', () => {
    render(<Sidebar {...defaults} />);
    fireEvent.click(screen.getByText('+'));
    expect(defaults.onNewApp).toHaveBeenCalled();
  });

  it('calls onImportApp when Import is clicked', () => {
    render(<Sidebar {...defaults} />);
    fireEvent.click(screen.getByText('Import'));
    expect(defaults.onImportApp).toHaveBeenCalled();
  });

  it('calls onOpenSettings when Settings is clicked', () => {
    render(<Sidebar {...defaults} />);
    fireEvent.click(screen.getByText('Settings'));
    expect(defaults.onOpenSettings).toHaveBeenCalled();
  });

  it('calls onExportApp when Export is clicked', () => {
    const app = makeApp();
    render(<Sidebar {...defaults} apps={[app]} />);
    fireEvent.click(screen.getByText('Export'));
    expect(defaults.onExportApp).toHaveBeenCalledWith(app.id);
  });

  it('requires double-click to delete an app', () => {
    const app = makeApp();
    render(<Sidebar {...defaults} apps={[app]} />);
    const delBtn = screen.getByTitle('Delete app');
    // First click arms it
    fireEvent.click(delBtn);
    expect(defaults.onDeleteApp).not.toHaveBeenCalled();
    // Second click confirms
    fireEvent.click(delBtn);
    expect(defaults.onDeleteApp).toHaveBeenCalledWith(app.id);
  });

  it('highlights selected app', () => {
    const app = makeApp();
    const { container } = render(<Sidebar {...defaults} apps={[app]} selectedApp={app} />);
    const item = container.querySelector('.sidebar-item.active');
    expect(item).toBeTruthy();
  });

  it('starts rename on double-click', () => {
    const app = makeApp();
    render(<Sidebar {...defaults} apps={[app]} />);
    const nameEl = screen.getByText('Test App');
    fireEvent.doubleClick(nameEl);
    // Should show rename input
    const input = screen.getByDisplayValue('Test App');
    expect(input).toBeTruthy();
  });

  it('commits rename on Enter', () => {
    const app = makeApp();
    render(<Sidebar {...defaults} apps={[app]} />);
    fireEvent.doubleClick(screen.getByText('Test App'));
    const input = screen.getByDisplayValue('Test App');
    fireEvent.change(input, { target: { value: 'New Name' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(defaults.onRenameApp).toHaveBeenCalledWith('test-1', 'New Name');
  });

  it('cancels rename on Escape', () => {
    const app = makeApp();
    render(<Sidebar {...defaults} apps={[app]} />);
    fireEvent.doubleClick(screen.getByText('Test App'));
    const input = screen.getByDisplayValue('Test App');
    fireEvent.keyDown(input, { key: 'Escape' });
    // Should exit rename mode without calling onRenameApp
    expect(defaults.onRenameApp).not.toHaveBeenCalled();
    expect(screen.getByText('Test App')).toBeTruthy();
  });

  it('commits rename on blur', () => {
    const app = makeApp();
    render(<Sidebar {...defaults} apps={[app]} />);
    fireEvent.doubleClick(screen.getByText('Test App'));
    const input = screen.getByDisplayValue('Test App');
    fireEvent.change(input, { target: { value: 'Blurred Name' } });
    fireEvent.blur(input);
    expect(defaults.onRenameApp).toHaveBeenCalledWith('test-1', 'Blurred Name');
  });

  it('does not rename if value unchanged', () => {
    const app = makeApp();
    render(<Sidebar {...defaults} apps={[app]} />);
    fireEvent.doubleClick(screen.getByText('Test App'));
    const input = screen.getByDisplayValue('Test App');
    fireEvent.blur(input);
    // Same name, should not call
    expect(defaults.onRenameApp).not.toHaveBeenCalled();
  });

  it('calls onDuplicateApp when Dup is clicked', () => {
    const app = makeApp();
    render(<Sidebar {...defaults} apps={[app]} />);
    fireEvent.click(screen.getByText('Dup'));
    expect(defaults.onDuplicateApp).toHaveBeenCalledWith('test-1');
  });

  it('calls onSelectApp on Enter key', () => {
    const app = makeApp();
    render(<Sidebar {...defaults} apps={[app]} />);
    const item = screen.getByRole('button', { name: /Select app Test App/ });
    fireEvent.keyDown(item, { key: 'Enter' });
    expect(defaults.onSelectApp).toHaveBeenCalledWith(app);
  });

  it('shows task queue badge when activeTasks > 0', () => {
    render(<Sidebar {...defaults} activeTasks={3} />);
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('calls onOpenTaskQueue when task queue button is clicked', () => {
    render(<Sidebar {...defaults} />);
    const btn = screen.getByText(/Tasks|Queue/i);
    fireEvent.click(btn);
    expect(defaults.onOpenTaskQueue).toHaveBeenCalled();
  });
});
