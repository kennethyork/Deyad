// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PackageManagerPanel from './PackageManagerPanel';

beforeEach(() => {
  (window as any).dyad = {
    npmList: vi.fn().mockResolvedValue({
      dependencies: { react: '18.2.0', 'react-dom': '18.2.0' },
      devDependencies: { vitest: '1.0.0' },
    }),
    npmInstall: vi.fn().mockResolvedValue({ success: true }),
    npmUninstall: vi.fn().mockResolvedValue({ success: true }),
  };
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
      expect(window.dyad.npmList).toHaveBeenCalledWith('app1');
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
      expect(window.dyad.npmInstall).toHaveBeenCalledWith('app1', 'lodash', false);
    });
  });
});
