// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import PluginMarketplace from './PluginMarketplace';

describe('PluginMarketplace', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).deyad = {
      pluginRegistryList: vi.fn().mockResolvedValue([
        { name: 'test-plugin', description: 'A test plugin', author: 'dev', version: '1.0.0', repo: 'https://github.com/dev/test-plugin', tags: ['tools'] },
        { name: 'theme-pack', description: 'Themes for Deyad', author: 'designer', version: '0.5.0', repo: 'https://github.com/designer/theme-pack', tags: ['themes'] },
      ]),
      listPlugins: vi.fn().mockResolvedValue([
        { name: 'test-plugin', description: 'A test plugin', templates: [] },
      ]),
      pluginInstall: vi.fn().mockResolvedValue({ success: true }),
      pluginUninstall: vi.fn().mockResolvedValue({ success: true }),
    };
  });
  afterEach(() => cleanup());

  it('renders marketplace heading and tabs', async () => {
    render(<PluginMarketplace onClose={onClose} />);
    expect(screen.getByText('🧩 Plugin Marketplace')).toBeTruthy();
    expect(screen.getByText('Browse Registry')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Installed (1)')).toBeTruthy();
    });
  });

  it('shows registry plugins after loading', async () => {
    render(<PluginMarketplace onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('test-plugin')).toBeTruthy();
      expect(screen.getByText('theme-pack')).toBeTruthy();
    });
  });

  it('shows installed badge for already-installed plugins', async () => {
    render(<PluginMarketplace onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('✓ Installed')).toBeTruthy();
    });
  });

  it('shows Install button for non-installed plugins', async () => {
    render(<PluginMarketplace onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('Install')).toBeTruthy();
    });
  });

  it('calls pluginInstall when Install is clicked', async () => {
    render(<PluginMarketplace onClose={onClose} />);
    await waitFor(() => screen.getByText('Install'));
    fireEvent.click(screen.getByText('Install'));
    expect(window.deyad.pluginInstall).toHaveBeenCalledWith('https://github.com/designer/theme-pack');
  });

  it('filters plugins by search', async () => {
    render(<PluginMarketplace onClose={onClose} />);
    await waitFor(() => screen.getByText('test-plugin'));
    const input = screen.getByPlaceholderText('Search plugins…');
    fireEvent.change(input, { target: { value: 'theme' } });
    expect(screen.queryByText('test-plugin')).toBeNull();
    expect(screen.getByText('theme-pack')).toBeTruthy();
  });

  it('switches to installed tab and shows uninstall button', async () => {
    render(<PluginMarketplace onClose={onClose} />);
    await waitFor(() => screen.getByText('Installed (1)'));
    fireEvent.click(screen.getByText('Installed (1)'));
    await waitFor(() => {
      expect(screen.getByText('Uninstall')).toBeTruthy();
    });
  });

  it('calls pluginUninstall when Uninstall is clicked', async () => {
    render(<PluginMarketplace onClose={onClose} />);
    await waitFor(() => screen.getByText('Installed (1)'));
    fireEvent.click(screen.getByText('Installed (1)'));
    await waitFor(() => screen.getByText('Uninstall'));
    fireEvent.click(screen.getByText('Uninstall'));
    expect(window.deyad.pluginUninstall).toHaveBeenCalledWith('test-plugin');
  });

  it('closes on overlay click', async () => {
    const { container } = render(<PluginMarketplace onClose={onClose} />);
    const overlay = container.querySelector('.modal-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on × button click', async () => {
    render(<PluginMarketplace onClose={onClose} />);
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows error on install failure', async () => {
    (window.deyad.pluginInstall as ReturnType<typeof vi.fn>).mockResolvedValue({ success: false, error: 'Network error' });
    render(<PluginMarketplace onClose={onClose} />);
    await waitFor(() => screen.getByText('Install'));
    fireEvent.click(screen.getByText('Install'));
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeTruthy();
    });
  });

  it('shows empty state when registry returns empty', async () => {
    (window.deyad.pluginRegistryList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (window.deyad.listPlugins as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<PluginMarketplace onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('No plugins in registry yet. Check back soon!')).toBeTruthy();
    });
  });

  it('displays plugin tags', async () => {
    render(<PluginMarketplace onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByText('tools')).toBeTruthy();
      expect(screen.getByText('themes')).toBeTruthy();
    });
  });
});
