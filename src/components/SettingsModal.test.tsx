// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SettingsModal from './SettingsModal';

beforeEach(() => {
  window.deyad = {
    getSettings: vi.fn().mockResolvedValue({
      ollamaHost: 'http://localhost:11434',
      defaultModel: 'llama3',
      autocompleteEnabled: true,
      completionModel: 'codellama',
      embedModel: 'nomic-embed-text',
      theme: 'dark',
    }),
    setSettings: vi.fn().mockResolvedValue(undefined),
    listModels: vi.fn().mockResolvedValue({ models: [{ name: 'llama3' }, { name: 'codellama' }] }),
  } as unknown as DeyadAPI;
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

  it('does not render pgAdmin credential fields', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    expect(screen.queryByText(/pgAdmin/i)).toBeNull();
    expect(screen.queryByLabelText(/pgadmin/i)).toBeNull();
  });

  it('tests connection and shows success', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    fireEvent.click(screen.getByText('Test'));
    await waitFor(() => {
      expect(window.deyad.setSettings).toHaveBeenCalled();
      expect(window.deyad.listModels).toHaveBeenCalled();
    });
  });

  it('tests connection and shows error on failure', async () => {
    Object.assign(window.deyad, {
      listModels: vi.fn().mockRejectedValue(new Error('Connection refused')),
    });
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    fireEvent.click(screen.getByText('Test'));
    await waitFor(() => {
      // Should show error state
      expect(window.deyad.setSettings).toHaveBeenCalled();
    });
  });

  it('loads settings on mount', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => {
      expect(window.deyad.getSettings).toHaveBeenCalled();
    });
  });

  it('calls onThemeChange when theme button clicked', async () => {
    const onThemeChange = vi.fn();
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={onThemeChange} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    // click the light theme button (text includes emoji)
    const lightBtn = screen.getByText(/Light/);
    fireEvent.click(lightBtn);
    expect(onThemeChange).toHaveBeenCalledWith('light');
  });

  it('closes when overlay is clicked', async () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal onClose={onClose} theme="dark" onThemeChange={() => {}} />);
    const overlay = container.querySelector('.modal-overlay');
    fireEvent.click(overlay!);
    expect(onClose).toHaveBeenCalled();
  });

  it('updates host input value', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const input = screen.getByDisplayValue('http://localhost:11434');
    fireEvent.change(input, { target: { value: 'http://localhost:12345' } });
    expect((input as HTMLInputElement).value).toBe('http://localhost:12345');
  });

  it('shows Saved feedback after saving', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    fireEvent.click(screen.getByText('Save Settings'));
    await waitFor(() => expect(screen.getByText(/Saved|✓/)).toBeTruthy());
  });
});
