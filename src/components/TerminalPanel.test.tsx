// @vitest-environment happy-dom
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import TerminalPanel from './TerminalPanel';

afterEach(cleanup);

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

describe('TerminalPanel — tab close', () => {
  beforeEach(() => {
    window.deyad = {
      createTerminal: vi.fn()
        .mockResolvedValueOnce('term1')
        .mockResolvedValueOnce('term2'),
      terminalWrite: vi.fn(),
      terminalResize: vi.fn(),
      onTerminalData: vi.fn().mockReturnValue(() => {}),
      onTerminalExit: vi.fn().mockReturnValue(() => {}),
      onTerminalClear: vi.fn().mockReturnValue(() => {}),
      showContextMenu: vi.fn().mockResolvedValue(undefined),
      terminalKill: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeyadAPI;
  });

  it('close button is hidden on single tab', async () => {
    const { container } = render(<TerminalPanel appId="foo" />);
    await Promise.resolve();
    await Promise.resolve();
    expect(container.querySelector('.terminal-tab-close')).toBeFalsy();
  });

  it('close button visible when multiple tabs exist', async () => {
    const { container } = render(<TerminalPanel appId="foo" />);
    // Wait for initial tab creation
    await waitFor(() => expect(container.querySelector('.terminal-tab')).toBeTruthy());
    // add second tab
    fireEvent.click(container.querySelector('.terminal-tab-add')!);
    await waitFor(() => {
      const closeBtns = container.querySelectorAll('.terminal-tab-close');
      expect(closeBtns.length).toBeGreaterThan(0);
    });
  });

  it('closing a tab calls terminalKill', async () => {
    const { container } = render(<TerminalPanel appId="foo" />);
    await waitFor(() => expect(container.querySelector('.terminal-tab')).toBeTruthy());
    fireEvent.click(container.querySelector('.terminal-tab-add')!);
    await waitFor(() => expect(container.querySelector('.terminal-tab-close')).toBeTruthy());
    fireEvent.click(container.querySelector('.terminal-tab-close')!);
    await waitFor(() => expect(window.deyad.terminalKill).toHaveBeenCalled());
  });
});

describe('TerminalPanel — tab switching', () => {
  beforeEach(() => {
    window.deyad = {
      createTerminal: vi.fn()
        .mockResolvedValueOnce('term1')
        .mockResolvedValueOnce('term2'),
      terminalWrite: vi.fn(),
      terminalResize: vi.fn(),
      onTerminalData: vi.fn().mockReturnValue(() => {}),
      onTerminalExit: vi.fn().mockReturnValue(() => {}),
      onTerminalClear: vi.fn().mockReturnValue(() => {}),
      showContextMenu: vi.fn().mockResolvedValue(undefined),
      terminalKill: vi.fn().mockResolvedValue(undefined),
    } as unknown as DeyadAPI;
  });

  it('clicking a tab makes it active', async () => {
    const { container } = render(<TerminalPanel appId="foo" />);
    await waitFor(() => expect(container.querySelector('.terminal-tab')).toBeTruthy());
    fireEvent.click(container.querySelector('.terminal-tab-add')!);
    await waitFor(() => {
      const tabs = container.querySelectorAll('.terminal-tab');
      expect(tabs.length).toBe(2);
    });
    const tabs = container.querySelectorAll('.terminal-tab');
    // second tab should be active (just created)
    expect(tabs[1].classList.contains('active')).toBe(true);
    // click first tab
    fireEvent.click(tabs[0]);
    await waitFor(() => expect(tabs[0].classList.contains('active')).toBe(true));
  });
});

describe('TerminalPanel — event subscriptions', () => {
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

  it('onTerminalData callback receives correct shape', () => {
    render(<TerminalPanel appId="foo" />);
    expect(window.deyad.onTerminalData).toHaveBeenCalledWith(expect.any(Function));
  });

  it('onTerminalExit callback receives correct shape', () => {
    render(<TerminalPanel appId="foo" />);
    expect(window.deyad.onTerminalExit).toHaveBeenCalledWith(expect.any(Function));
  });

  it('returns cleanup functions on unmount', () => {
    const unsubData = vi.fn();
    const unsubExit = vi.fn();
    const unsubClear = vi.fn();
    window.deyad.onTerminalData = vi.fn().mockReturnValue(unsubData);
    window.deyad.onTerminalExit = vi.fn().mockReturnValue(unsubExit);
    window.deyad.onTerminalClear = vi.fn().mockReturnValue(unsubClear);
    const { unmount } = render(<TerminalPanel appId="foo" />);
    unmount();
    expect(unsubData).toHaveBeenCalled();
    expect(unsubExit).toHaveBeenCalled();
    expect(unsubClear).toHaveBeenCalled();
  });
});

describe('TerminalPanel — tab labels', () => {
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

  it('first tab is labeled Terminal 1', async () => {
    const { container } = render(<TerminalPanel appId="foo" />);
    await waitFor(() => {
      const label = container.querySelector('.terminal-tab-label');
      expect(label).toBeTruthy();
    });
    const label = container.querySelector('.terminal-tab-label');
    expect(label?.textContent).toMatch(/Terminal \d+/);
  });

  it('+ button has title "New terminal"', () => {
    const { container } = render(<TerminalPanel />);
    const addBtn = container.querySelector('.terminal-tab-add')!;
    expect(addBtn.getAttribute('title')).toBe('New terminal');
  });
});

describe('TerminalPanel — unmount cleanup', () => {
  it('kills all terminals on unmount', async () => {
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
    const { unmount, container } = render(<TerminalPanel appId="foo" />);
    await waitFor(() => expect(container.querySelector('.terminal-tab')).toBeTruthy());
    unmount();
    expect(window.deyad.terminalKill).toHaveBeenCalled();
  });
});