import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn(() => ({})) },
  ipcMain: { handle: vi.fn() },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-term-id'),
}));

const mockTerm = {
  onData: vi.fn(),
  onExit: vi.fn(),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
};
const mockSpawn = vi.fn(() => mockTerm);

vi.mock('node-pty', () => ({
  spawn: mockSpawn,
}));

const handlers = new Map<string, Function>();

import { ipcMain } from 'electron';

beforeEach(async () => {
  handlers.clear();
  const { _setPtyForTest } = await import('./ipcTerminal');
  _setPtyForTest({ spawn: mockSpawn });
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
    handlers.set(channel, handler);
    return undefined as any;
  });
});

afterEach(async () => {
  const { getTerminals } = await import('./ipcTerminal');
  getTerminals().clear();
  vi.restoreAllMocks();
});

describe('ipcTerminal handler registration', () => {
  it('registers all 5 terminal handlers', async () => {
    const { registerTerminalHandlers } = await import('./ipcTerminal');
    registerTerminalHandlers((_id: string) => '/tmp/test');

    expect(handlers.has('terminal:start')).toBe(true);
    expect(handlers.has('terminal:write')).toBe(true);
    expect(handlers.has('terminal:resize')).toBe(true);
    expect(handlers.has('terminal:kill')).toBe(true);
    expect(handlers.has('show-context-menu')).toBe(true);
  });

  it('terminal:start returns an id and stores the terminal', async () => {
    const { registerTerminalHandlers, getTerminals } = await import('./ipcTerminal');
    registerTerminalHandlers((_id: string) => '/tmp/test');

    const handler = handlers.get('terminal:start')!;
    const event = { sender: { send: vi.fn() } };
    const id = handler(event, { appId: 'app1' });
    expect(id).toBe('mock-term-id');
    expect(getTerminals().has('mock-term-id')).toBe(true);
  });

  it('terminal:write writes data to existing terminal', async () => {
    const { registerTerminalHandlers, getTerminals } = await import('./ipcTerminal');
    registerTerminalHandlers((_id: string) => '/tmp/test');

    // Manually set a mock terminal
    getTerminals().set('t1', mockTerm);

    const handler = handlers.get('terminal:write')!;
    handler({}, { termId: 't1', data: 'ls\n' });
    expect(mockTerm.write).toHaveBeenCalledWith('ls\n');
  });

  it('terminal:resize resizes existing terminal', async () => {
    const { registerTerminalHandlers, getTerminals } = await import('./ipcTerminal');
    registerTerminalHandlers((_id: string) => '/tmp/test');

    getTerminals().set('t1', mockTerm);

    const handler = handlers.get('terminal:resize')!;
    handler({}, { termId: 't1', cols: 120, rows: 40 });
    expect(mockTerm.resize).toHaveBeenCalledWith(120, 40);
  });

  it('terminal:kill kills and removes terminal', async () => {
    const { registerTerminalHandlers, getTerminals } = await import('./ipcTerminal');
    registerTerminalHandlers((_id: string) => '/tmp/test');

    getTerminals().set('t1', mockTerm);

    const handler = handlers.get('terminal:kill')!;
    handler({}, 't1');
    expect(mockTerm.kill).toHaveBeenCalled();
    expect(getTerminals().has('t1')).toBe(false);
  });
});
