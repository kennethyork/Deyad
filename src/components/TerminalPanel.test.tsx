// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import TerminalPanel from './TerminalPanel';

describe('TerminalPanel', () => {
  beforeEach(() => {
    window.deyad = {
      createTerminal: vi.fn().mockResolvedValue('term1'),
      terminalWrite: vi.fn(),
      terminalResize: vi.fn(),
      onTerminalData: vi.fn().mockReturnValue(() => {}),
      onTerminalExit: vi.fn().mockReturnValue(() => {}),
      onTerminalClear: vi.fn().mockReturnValue(() => {}),
      showContextMenu: vi.fn().mockResolvedValue(undefined),
      terminalKill: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeyadAPI;
  });

  it('renders terminal panel and tab bar', async () => {
    const { container } = render(<TerminalPanel appId="foo" />);
    expect(container.querySelector('.terminal-panel')).toBeTruthy();
    // Tab bar with + button should exist
    expect(container.querySelector('.terminal-tab-bar')).toBeTruthy();
    expect(container.querySelector('.terminal-tab-add')).toBeTruthy();
    // Initial tab should be created
    await Promise.resolve();
    expect(window.deyad.createTerminal).toHaveBeenCalledWith('foo');
  });

  it('subscribes to terminal data and exit events', () => {
    render(<TerminalPanel appId="foo" />);
    expect(window.deyad.onTerminalData).toHaveBeenCalled();
    expect(window.deyad.onTerminalExit).toHaveBeenCalled();
    expect(window.deyad.onTerminalClear).toHaveBeenCalled();
  });

  it('creates new tab when + button is clicked', async () => {
    const { container } = render(<TerminalPanel appId="foo" />);
    await Promise.resolve();
    const addBtn = container.querySelector('.terminal-tab-add')!;
    fireEvent.click(addBtn);
    // Should call createTerminal again
    await Promise.resolve();
    expect(window.deyad.createTerminal).toHaveBeenCalledTimes(2);
  });

  it('renders without appId', () => {
    const { container } = render(<TerminalPanel />);
    expect(container.querySelector('.terminal-panel')).toBeTruthy();
  });
});