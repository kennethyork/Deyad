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

  /* ── Autocomplete toggle ───────────────────────────── */

  it('shows completion model dropdown when autocomplete is enabled', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    // autocompleteEnabled defaults to true in our mock
    expect(screen.getByLabelText('Completion Model')).toBeTruthy();
  });

  it('hides completion model dropdown when autocomplete disabled', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    // uncheck autocomplete
    const checkbox = screen.getByLabelText(/inline autocomplete/i);
    fireEvent.click(checkbox);
    expect(screen.queryByLabelText('Completion Model')).toBeNull();
  });

  it('shows autocomplete hint text', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    expect(screen.getByText(/AI-powered code suggestions/)).toBeTruthy();
  });

  /* ── Slider controls ───────────────────────────────── */

  it('renders temperature slider with default value', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const slider = screen.getByLabelText('Temperature') as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(slider.value).toBe('0.7');
  });

  it('updates temperature when slider changes', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const slider = screen.getByLabelText('Temperature') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '1.2' } });
    expect(slider.value).toBe('1.2');
    expect(screen.getByText('1.2')).toBeTruthy();
  });

  it('renders topP slider with default value', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const slider = screen.getByLabelText('Top P') as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(slider.value).toBe('0.9');
  });

  it('updates topP when slider changes', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const slider = screen.getByLabelText('Top P') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '0.5' } });
    expect(slider.value).toBe('0.5');
    expect(screen.getByText('0.50')).toBeTruthy();
  });

  it('renders repeat penalty slider with default value', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const slider = screen.getByLabelText('Repeat Penalty') as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(slider.value).toBe('1.1');
  });

  it('updates repeatPenalty when slider changes', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const slider = screen.getByLabelText('Repeat Penalty') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(slider.value).toBe('1.5');
    expect(screen.getByText('1.50')).toBeTruthy();
  });

  /* ── Save passes all fields ────────────────────────── */

  it('save passes all settings fields correctly', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());

    // change temperature
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '1.0' } });
    fireEvent.click(screen.getByText('Save Settings'));
    await waitFor(() => expect(window.deyad.setSettings).toHaveBeenCalled());
    const call = (window.deyad.setSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.ollamaHost).toBe('http://localhost:11434');
    expect(call.defaultModel).toBe('llama3');
    expect(call.autocompleteEnabled).toBe(true);
    expect(call.completionModel).toBe('codellama');
    expect(call.embedModel).toBe('nomic-embed-text');
    expect(call.temperature).toBe(1.0);
    expect(call.topP).toBe(0.9);
    expect(call.repeatPenalty).toBe(1.1);
    expect(call.theme).toBe('dark');
  });

  /* ── Test connection states ────────────────────────── */

  it('shows Testing… while connection test in progress', async () => {
    // make listModels hang
    Object.assign(window.deyad, {
      listModels: vi.fn().mockImplementation(() => new Promise(() => {})),
    });
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    fireEvent.click(screen.getByText('Test'));
    expect(screen.getByText('Testing…')).toBeTruthy();
  });

  it('test connection success updates model list', async () => {
    Object.assign(window.deyad, {
      listModels: vi.fn()
        .mockResolvedValueOnce({ models: [{ name: 'llama3' }] })          // initial load
        .mockResolvedValueOnce({ models: [{ name: 'llama3' }, { name: 'phi3' }] }),  // after test
    });
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    fireEvent.click(screen.getByText('Test'));
    await waitFor(() => expect(screen.getByText('Success')).toBeTruthy());
  });

  it('test button is disabled while testing', async () => {
    Object.assign(window.deyad, {
      listModels: vi.fn().mockImplementation(() => new Promise(() => {})),
    });
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    fireEvent.click(screen.getByText('Test'));
    const btn = screen.getByText('Testing…');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  /* ── Default model dropdown ────────────────────────── */

  it('default model select has auto option', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const select = screen.getByLabelText('Default Model') as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.text);
    expect(options[0]).toBe('Auto (use first available)');
  });

  it('changes default model selection', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const select = screen.getByLabelText('Default Model') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'codellama' } });
    expect(select.value).toBe('codellama');
  });

  /* ── Embed model dropdown ──────────────────────────── */

  it('embed model select has none option', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const select = screen.getByLabelText(/Embedding Model/) as HTMLSelectElement;
    const options = Array.from(select.options).map(o => o.text);
    expect(options[0]).toBe('None (TF-IDF only)');
  });

  it('shows RAG hint text', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    expect(screen.getByText(/Enable RAG for smarter context/)).toBeTruthy();
  });

  /* ── Theme toggle active state ─────────────────────── */

  it('dark button is active when theme is dark', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const darkBtn = screen.getByText(/Dark/);
    expect(darkBtn.className).toContain('active');
    const lightBtn = screen.getByText(/Light/);
    expect(lightBtn.className).not.toContain('active');
  });

  it('light button is active when theme is light', async () => {
    render(<SettingsModal onClose={() => {}} theme="light" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const lightBtn = screen.getByText(/Light/);
    expect(lightBtn.className).toContain('active');
  });

  /* ── Cancel button ─────────────────────────────────── */

  it('cancel button calls onClose', async () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  /* ── Modal stops propagation ───────────────────────── */

  it('modal dialog click does not close', async () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal onClose={onClose} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const dialog = container.querySelector('.settings-modal')!;
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
  });

  /* ── Slider hint text ──────────────────────────────── */

  it('shows hint text for each slider', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    expect(screen.getByText(/Higher = more creative/)).toBeTruthy();
    expect(screen.getByText(/Nucleus sampling/)).toBeTruthy();
    expect(screen.getByText(/Penalize repetition/)).toBeTruthy();
  });

  /* ── Settings load populates sliders ───────────────── */

  it('loads custom slider values from settings', async () => {
    Object.assign(window.deyad, {
      getSettings: vi.fn().mockResolvedValue({
        ollamaHost: 'http://localhost:11434',
        defaultModel: '',
        autocompleteEnabled: false,
        completionModel: '',
        embedModel: '',
        temperature: 1.5,
        topP: 0.4,
        repeatPenalty: 1.8,
        theme: 'dark',
      }),
    });
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    expect((screen.getByLabelText('Temperature') as HTMLInputElement).value).toBe('1.5');
    expect((screen.getByLabelText('Top P') as HTMLInputElement).value).toBe('0.4');
    expect((screen.getByLabelText('Repeat Penalty') as HTMLInputElement).value).toBe('1.8');
  });

  /* ── listModels failure handled gracefully ─────────── */

  it('handles initial listModels failure gracefully', async () => {
    Object.assign(window.deyad, {
      listModels: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    // Should still render with empty model list, no crash
    const select = screen.getByLabelText('Default Model') as HTMLSelectElement;
    expect(select.options.length).toBe(1); // only "Auto" option
  });

  /* ── Save button states ────────────────────────────── */

  it('shows Saving… while save in progress', async () => {
    Object.assign(window.deyad, {
      setSettings: vi.fn().mockImplementation(() => new Promise(() => {})),
    });
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    fireEvent.click(screen.getByText('Save Settings'));
    expect(screen.getByText('Saving…')).toBeTruthy();
    expect((screen.getByText('Saving…') as HTMLButtonElement).disabled).toBe(true);
  });

  /* ── Aria attributes ───────────────────────────────── */

  it('modal has correct aria attributes', async () => {
    const { container } = render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    expect(dialog!.getAttribute('aria-label')).toBe('Settings');
  });

  /* ── Host trimming on save ─────────────────────────── */

  it('trims whitespace from host URL on save', async () => {
    render(<SettingsModal onClose={() => {}} theme="dark" onThemeChange={() => {}} />);
    await waitFor(() => expect(screen.getByDisplayValue('http://localhost:11434')).toBeTruthy());
    const input = screen.getByDisplayValue('http://localhost:11434');
    fireEvent.change(input, { target: { value: '  http://myhost:1234  ' } });
    fireEvent.click(screen.getByText('Save Settings'));
    await waitFor(() => expect(window.deyad.setSettings).toHaveBeenCalled());
    const call = (window.deyad.setSettings as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.ollamaHost).toBe('http://myhost:1234');
  });
});
