// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SettingsModal from './SettingsModal';

beforeEach(() => {
  (window as any).deyad = {
    getSettings: vi.fn().mockResolvedValue({
      ollamaHost: 'http://localhost:11434',
      defaultModel: 'llama3',
      autocompleteEnabled: true,
      completionModel: 'codellama',
      embedModel: 'nomic-embed-text',
      pgAdminEmail: 'admin@admin.com',
      pgAdminPassword: 'admin',
      theme: 'dark',
    }),
    setSettings: vi.fn().mockResolvedValue(undefined),
    listModels: vi.fn().mockResolvedValue({ models: [{ name: 'llama3' }, { name: 'codellama' }] }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsModal', () => {
  it('renders settings form with loaded values', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy();
    });
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    fireEvent.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('saves settings when save button is clicked', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    fireEvent.click(screen.getByText('Save Settings'));
    await waitFor(() => expect(window.deyad.setSettings).toHaveBeenCalled());
  });

  it('shows model list from Ollama', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => {
      // Models should be loaded and available in dropdowns
      expect(window.deyad.listModels).toHaveBeenCalled();
    });
  });

  it('resets pgAdmin credentials to defaults', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const resetBtn = screen.getByText('Reset to Defaults');
    fireEvent.click(resetBtn);
    await waitFor(() => {
      expect(screen.getByDisplayValue('admin@admin.com')).toBeTruthy();
    });
  });
});
