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
});
