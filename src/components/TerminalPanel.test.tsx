// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import TerminalPanel from './TerminalPanel';

describe('TerminalPanel', () => {
  beforeEach(() => {
    (window as any).deyad = {
      createTerminal: vi.fn().mockResolvedValue('term1'),
      terminalWrite: vi.fn(),
      terminalResize: vi.fn(),
      onTerminalData: vi.fn().mockReturnValue(() => {}),
      onTerminalExit: vi.fn().mockReturnValue(() => {}),
      onTerminalClear: vi.fn().mockReturnValue(() => {}),
      showContextMenu: vi.fn().mockResolvedValue(undefined),
      terminalKill: vi.fn().mockResolvedValue(undefined),
    };
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
});