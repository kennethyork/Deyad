// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import EnvVarsPanel from './EnvVarsPanel';

beforeEach(() => {
  window.deyad = {
    envRead: vi.fn().mockResolvedValue({
      '.env': { DATABASE_URL: 'postgres://localhost', API_KEY: 'secret123' },
    }),
    envWrite: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as DeyadAPI;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EnvVarsPanel', () => {
  it('loads and displays environment variables', async () => {
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => {
      expect(screen.getByText('DATABASE_URL')).toBeTruthy();
      expect(screen.getByText('API_KEY')).toBeTruthy();
    });
  });

  it('calls envRead on mount', async () => {
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => {
      expect(window.deyad.envRead).toHaveBeenCalledWith('app1');
    });
  });

  it('shows file tabs for multiple env files', async () => {
    Object.assign(window.deyad, { envRead: vi.fn().mockResolvedValue({
      '.env': { KEY1: 'val1' },
      '.env.local': { KEY2: 'val2' },
    }) });
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => {
      expect(screen.getByText('.env')).toBeTruthy();
      expect(screen.getByText('.env.local')).toBeTruthy();
    });
  });

  it('adds a new variable when add is clicked', async () => {
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => expect(screen.getByText('DATABASE_URL')).toBeTruthy());

    const inputs = screen.getAllByRole('textbox');
    // Find key and value inputs (the last two textboxes are the add-new inputs)
    const keyInput = inputs[inputs.length - 2];
    const valueInput = inputs[inputs.length - 1];

    fireEvent.change(keyInput, { target: { value: 'NEW_VAR' } });
    fireEvent.change(valueInput, { target: { value: 'new_value' } });
    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => {
      expect(window.deyad.envWrite).toHaveBeenCalled();
    });
  });

  it('shows empty state gracefully', async () => {
    Object.assign(window.deyad, { envRead: vi.fn().mockResolvedValue({}) });
    const { container } = render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => {
      expect(window.deyad.envRead).toHaveBeenCalled();
    });
    // Should render without crashing
    expect(container.innerHTML).toBeTruthy();
  });

  it('switches active file when clicking a tab', async () => {
    Object.assign(window.deyad, { envRead: vi.fn().mockResolvedValue({
      '.env': { KEY1: 'val1' },
      '.env.local': { KEY2: 'val2' },
    }) });
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => expect(screen.getByText('.env.local')).toBeTruthy());
    fireEvent.click(screen.getByText('.env.local'));
    await waitFor(() => {
      expect(screen.getByText('KEY2')).toBeTruthy();
    });
  });

  it('deletes a variable when delete is clicked', async () => {
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => expect(screen.getByText('DATABASE_URL')).toBeTruthy());
    const removeButtons = screen.getAllByText('×');
    fireEvent.click(removeButtons[0]);
    await waitFor(() => {
      expect(window.deyad.envWrite).toHaveBeenCalled();
    });
  });

  it('does not add a variable when key is empty', async () => {
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => expect(screen.getByText('DATABASE_URL')).toBeTruthy());
    fireEvent.click(screen.getByText('Add'));
    // envWrite should not be called again beyond initial load
    expect(window.deyad.envWrite).not.toHaveBeenCalled();
  });

  it('creates new env file when + is clicked', async () => {
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => expect(screen.getByText('DATABASE_URL')).toBeTruthy());
    // First click shows input
    fireEvent.click(screen.getByText('+'));
    const input = screen.getByPlaceholderText('.env.local');
    expect(input).toBeTruthy();
  });

  it('validates new env file name must start with .env', async () => {
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => expect(screen.getByText('DATABASE_URL')).toBeTruthy());
    fireEvent.click(screen.getByText('+'));
    const input = screen.getByPlaceholderText('.env.local');
    fireEvent.change(input, { target: { value: 'config.yml' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByText(/must start with .env/)).toBeTruthy();
    });
  });

  it('shows saved status after successful write', async () => {
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => expect(screen.getByText('DATABASE_URL')).toBeTruthy());
    const removeButtons = screen.getAllByText('×');
    fireEvent.click(removeButtons[0]);
    await waitFor(() => {
      expect(screen.getByText(/Saved|✓/)).toBeTruthy();
    });
  });

  it('shows error status on write failure', async () => {
    Object.assign(window.deyad, {
      envWrite: vi.fn().mockResolvedValue({ success: false, error: 'Permission denied' }),
    });
    render(<EnvVarsPanel appId="app1" />);
    await waitFor(() => expect(screen.getByText('DATABASE_URL')).toBeTruthy());
    const removeButtons = screen.getAllByText('×');
    fireEvent.click(removeButtons[0]);
    await waitFor(() => {
      expect(screen.getByText(/Permission denied/)).toBeTruthy();
    });
  });
});
