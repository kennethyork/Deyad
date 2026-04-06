// @vitest-environment happy-dom
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CommandPalette from './CommandPalette';
import type { Command } from './CommandPalette';

function makeCommands(n = 5): Command[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `cmd-${i}`,
    name: `Command ${i}`,
    icon: '🔧',
    shortcut: i === 0 ? 'Ctrl+P' : undefined,
    run: vi.fn(),
  }));
}

describe('CommandPalette', () => {
  it('renders all commands by default', () => {
    const cmds = makeCommands(3);
    const { container } = render(<CommandPalette commands={cmds} onClose={vi.fn()} />);
    const items = container.querySelectorAll('.command-palette-item');
    expect(items.length).toBe(3);
  });

  it('displays command names and icons', () => {
    const cmds = makeCommands(2);
    const { container } = render(<CommandPalette commands={cmds} onClose={vi.fn()} />);
    const labels = container.querySelectorAll('.command-palette-label');
    expect(labels.length).toBe(2);
    expect(labels[0].textContent).toBe('Command 0');
    expect(labels[1].textContent).toBe('Command 1');
  });

  it('shows shortcut when provided', () => {
    const cmds = makeCommands(2);
    const { container } = render(<CommandPalette commands={cmds} onClose={vi.fn()} />);
    const shortcuts = container.querySelectorAll('.command-palette-shortcut');
    expect(shortcuts.length).toBe(1);
    expect(shortcuts[0].textContent).toBe('Ctrl+P');
  });

  it('filters commands by query', () => {
    const cmds = [
      { id: '1', name: 'Open File', icon: '📂', run: vi.fn() },
      { id: '2', name: 'Save All', icon: '💾', run: vi.fn() },
      { id: '3', name: 'Open Terminal', icon: '🖥', run: vi.fn() },
    ];
    const { container } = render(<CommandPalette commands={cmds} onClose={vi.fn()} />);
    const input = container.querySelector('.command-palette-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Open' } });
    const items = container.querySelectorAll('.command-palette-item');
    expect(items.length).toBe(2);
  });

  it('shows empty state when no matches', () => {
    const cmds = makeCommands(2);
    const { container, getByText } = render(<CommandPalette commands={cmds} onClose={vi.fn()} />);
    const input = container.querySelector('.command-palette-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzzzzzz' } });
    expect(getByText('No matching commands')).toBeTruthy();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    const { container } = render(<CommandPalette commands={makeCommands()} onClose={onClose} />);
    const input = container.querySelector('.command-palette-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when overlay is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<CommandPalette commands={makeCommands()} onClose={onClose} />);
    const overlay = container.querySelector('.command-palette-overlay') as HTMLElement;
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose when palette body is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<CommandPalette commands={makeCommands()} onClose={onClose} />);
    const palette = container.querySelector('.command-palette') as HTMLElement;
    fireEvent.click(palette);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('executes command on Enter', () => {
    const cmds = makeCommands(3);
    const onClose = vi.fn();
    const { container } = render(<CommandPalette commands={cmds} onClose={onClose} />);
    const input = container.querySelector('.command-palette-input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(cmds[0].run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('executes command on click', () => {
    const cmds = makeCommands(3);
    const onClose = vi.fn();
    const { container } = render(<CommandPalette commands={cmds} onClose={onClose} />);
    const items = container.querySelectorAll('.command-palette-item');
    fireEvent.click(items[1]);
    expect(cmds[1].run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates with ArrowDown and ArrowUp', () => {
    const cmds = makeCommands(3);
    const { container } = render(<CommandPalette commands={cmds} onClose={vi.fn()} />);
    const input = container.querySelector('.command-palette-input') as HTMLInputElement;

    // First item selected by default
    expect(container.querySelectorAll('.command-palette-item.selected').length).toBe(1);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const selected1 = container.querySelector('.command-palette-item.selected');
    expect(selected1?.textContent).toContain('Command 1');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const selected2 = container.querySelector('.command-palette-item.selected');
    expect(selected2?.textContent).toContain('Command 2');

    // Should not go past last
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const selected3 = container.querySelector('.command-palette-item.selected');
    expect(selected3?.textContent).toContain('Command 2');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    const selected4 = container.querySelector('.command-palette-item.selected');
    expect(selected4?.textContent).toContain('Command 1');
  });

  it('resets selection when query changes', () => {
    const cmds = makeCommands(5);
    const { container } = render(<CommandPalette commands={cmds} onClose={vi.fn()} />);
    const input = container.querySelector('.command-palette-input') as HTMLInputElement;

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // Now selection is at index 2

    fireEvent.change(input, { target: { value: 'Com' } });
    // Selection should reset to 0
    const selected = container.querySelector('.command-palette-item.selected');
    expect(selected?.textContent).toContain('Command 0');
  });

  it('updates selection on mouse enter', () => {
    const cmds = makeCommands(3);
    const { container } = render(<CommandPalette commands={cmds} onClose={vi.fn()} />);
    const items = container.querySelectorAll('.command-palette-item');
    fireEvent.mouseEnter(items[2]);
    expect(items[2].classList.contains('selected')).toBe(true);
  });

  it('auto-focuses the input on mount', () => {
    const { container } = render(<CommandPalette commands={makeCommands()} onClose={vi.fn()} />);
    const input = container.querySelector('.command-palette-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
  });
});
