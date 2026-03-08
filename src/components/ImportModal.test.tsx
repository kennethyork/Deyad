// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import ImportModal from './ImportModal';

describe('ImportModal', () => {
  const onClose = vi.fn();
  const onImport = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('renders heading and input', () => {
    render(<ImportModal onClose={onClose} onImport={onImport} />);
    expect(screen.getByText('Import Project')).toBeTruthy();
    expect(screen.getByPlaceholderText('My Imported App')).toBeTruthy();
  });

  it('disables submit when name is empty', () => {
    render(<ImportModal onClose={onClose} onImport={onImport} />);
    const btn = screen.getByText('Choose Folder & Import');
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables submit when name is entered', () => {
    render(<ImportModal onClose={onClose} onImport={onImport} />);
    const input = screen.getByPlaceholderText('My Imported App');
    fireEvent.change(input, { target: { value: 'TestApp' } });
    const btn = screen.getByText('Choose Folder & Import');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls onImport with trimmed name on click', () => {
    render(<ImportModal onClose={onClose} onImport={onImport} />);
    const input = screen.getByPlaceholderText('My Imported App');
    fireEvent.change(input, { target: { value: '  My App  ' } });
    fireEvent.click(screen.getByText('Choose Folder & Import'));
    expect(onImport).toHaveBeenCalledWith('My App');
  });

  it('calls onImport on Enter key', () => {
    render(<ImportModal onClose={onClose} onImport={onImport} />);
    const input = screen.getByPlaceholderText('My Imported App');
    fireEvent.change(input, { target: { value: 'EnterApp' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onImport).toHaveBeenCalledWith('EnterApp');
  });

  it('calls onClose when Cancel is clicked', () => {
    render(<ImportModal onClose={onClose} onImport={onImport} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay is clicked', () => {
    const { container } = render(<ImportModal onClose={onClose} onImport={onImport} />);
    const overlay = container.querySelector('.modal-overlay')!;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when modal body is clicked', () => {
    const { container } = render(<ImportModal onClose={onClose} onImport={onImport} />);
    const modal = container.querySelector('.modal')!;
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not submit empty/whitespace name', () => {
    render(<ImportModal onClose={onClose} onImport={onImport} />);
    const input = screen.getByPlaceholderText('My Imported App');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onImport).not.toHaveBeenCalled();
  });
});
