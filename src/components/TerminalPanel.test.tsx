// @vitest-environment happy-dom
// @ts-nocheck
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
    };
  });

  it('renders and calls createTerminal', async () => {
    const { container } = render(<TerminalPanel appId="foo" />);
    expect(container.querySelector('.terminal-panel')).toBeTruthy();
    // wait a tick for effect
    await Promise.resolve();
    expect(window.deyad.createTerminal).toHaveBeenCalledWith('foo');
  });
});