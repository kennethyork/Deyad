// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PackageManagerPanel from './PackageManagerPanel';

beforeEach(() => {
  window.deyad = {
    npmList: vi.fn().mockResolvedValue({
      dependencies: { react: '18.2.0', 'react-dom': '18.2.0' },
      devDependencies: { vitest: '1.0.0' },
    }),
    npmInstall: vi.fn().mockResolvedValue({ success: true }),
    npmUninstall: vi.fn().mockResolvedValue({ success: true }),
  } as unknown as DeyadAPI;
});

afterEach(cleanup);

describe('PackageManagerPanel', () => {
  it('loads and displays dependencies', async () => {
    render(<PackageManagerPanel appId="app1" />);
    await waitFor(() => {
      expect(screen.getByText('react')).toBeTruthy();
      expect(screen.getByText('react-dom')).toBeTruthy();
    });
  });

  it('loads and displays devDependencies', async () => {
    render(<PackageManagerPanel appId="app1" />);
    await waitFor(() => {
      expect(screen.getByText('vitest')).toBeTruthy();
    });
  });

  it('calls npmList on mount', async () => {
    render(<PackageManagerPanel appId="app1" />);
    await waitFor(() => {
      expect(window.deyad.npmList).toHaveBeenCalledWith('app1');
    });
  });

  it('has an install input and button', () => {
    render(<PackageManagerPanel appId="app1" />);
    expect(screen.getByPlaceholderText(/package/i)).toBeTruthy();
    expect(screen.getByText(/Install/i)).toBeTruthy();
  });

  it('calls npmInstall when install button is clicked', async () => {
    render(<PackageManagerPanel appId="app1" />);
    const input = screen.getByPlaceholderText(/package/i);
    fireEvent.change(input, { target: { value: 'lodash' } });
    fireEvent.click(screen.getByText(/Install/i));
    await waitFor(() => {
      expect(window.deyad.npmInstall).toHaveBeenCalledWith('app1', 'lodash', false);
    });
  });

  it('installs dev dependency when checkbox is checked', async () => {
    render(<PackageManagerPanel appId="app1" />);
    const input = screen.getByPlaceholderText(/package/i);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    fireEvent.change(input, { target: { value: 'eslint' } });
    fireEvent.click(screen.getByText(/Install/i));
    await waitFor(() => {
      expect(window.deyad.npmInstall).toHaveBeenCalledWith('app1', 'eslint', true);
    });
  });

  it('installs on Enter key', async () => {
    render(<PackageManagerPanel appId="app1" />);
    const input = screen.getByPlaceholderText(/package/i);
    fireEvent.change(input, { target: { value: 'axios' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(window.deyad.npmInstall).toHaveBeenCalledWith('app1', 'axios', false);
    });
  });

  it('shows uninstall confirmation when × is clicked', async () => {
    render(<PackageManagerPanel appId="app1" />);
    await waitFor(() => expect(screen.getByText('react')).toBeTruthy());
    const removeButtons = screen.getAllByTitle('Uninstall');
    fireEvent.click(removeButtons[0]);
    // ConfirmDialog should appear
    await waitFor(() => {
      expect(screen.getByText(/Uninstall react/)).toBeTruthy();
    });
  });

  it('shows status after successful install', async () => {
    render(<PackageManagerPanel appId="app1" />);
    const input = screen.getByPlaceholderText(/package/i);
    fireEvent.change(input, { target: { value: 'lodash' } });
    fireEvent.click(screen.getByText(/Install/i));
    await waitFor(() => {
      expect(screen.getByText(/Installed lodash|✓/)).toBeTruthy();
    });
  });

  it('shows error status on install failure', async () => {
    Object.assign(window.deyad, {
      npmInstall: vi.fn().mockResolvedValue({ success: false, error: 'Not found' }),
    });
    render(<PackageManagerPanel appId="app1" />);
    const input = screen.getByPlaceholderText(/package/i);
    fireEvent.change(input, { target: { value: 'fake-pkg' } });
    fireEvent.click(screen.getByText(/Install/i));
    await waitFor(() => {
      expect(screen.getByText(/Not found/)).toBeTruthy();
    });
  });

  it('does not install empty package name', async () => {
    render(<PackageManagerPanel appId="app1" />);
    fireEvent.click(screen.getByText(/Install/i));
    expect(window.deyad.npmInstall).not.toHaveBeenCalled();
  });

  it('shows empty state when no deps/devDeps', async () => {
    Object.assign(window.deyad, {
      npmList: vi.fn().mockResolvedValue({ dependencies: {}, devDependencies: {} }),
    });
    render(<PackageManagerPanel appId="app1" />);
    await waitFor(() => {
      expect(screen.getByText('No dependencies')).toBeTruthy();
      expect(screen.getByText('No dev dependencies')).toBeTruthy();
    });
  });
});
