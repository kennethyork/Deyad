/**
 * Terminal IPC handlers (node-pty).
 */

import { BrowserWindow, ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';

// Load node-pty at module level so vi.mock('node-pty') can intercept it in tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pty: { spawn: (...args: any[]) => any } | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  _pty = require('node-pty');
} catch {
  _pty = null;
}

/** @internal For testing only. Injects a mock node-pty implementation. */
export function _setPtyForTest(pty: typeof _pty): void {
  _pty = pty;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const terminals = new Map<string, any>();

export function getTerminals(): typeof terminals {
  return terminals;
}

export function registerTerminalHandlers(appDir: (id: string) => string): void {
  ipcMain.handle('terminal:start', (_event, { appId }: { appId?: string }) => {
    if (!_pty) {
      throw new Error('node-pty is not available. Rebuild native modules with electron-rebuild.');
    }
    const cwd = appId ? appDir(appId) : undefined;
    const shellPath = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/bash';
    let term;
    try {
      term = _pty.spawn(shellPath, [], { cwd, env: process.env });
    } catch (spawnErr) {
      throw new Error(`Failed to spawn terminal: ${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}`);
    }
    const id = uuidv4();
    terminals.set(id, term);

    term.onData((data: string) => {
      _event.sender.send('terminal:data', { id, data });
    });
    term.onExit(({ exitCode, signal }: { exitCode: number; signal: number }) => {
      _event.sender.send('terminal:exit', { id, exitCode, signal });
      terminals.delete(id);
    });
    return id;
  });

  ipcMain.handle('terminal:write', (_event, { termId, data }: { termId: string; data: string }) => {
    const term = terminals.get(termId);
    if (term) term.write(data);
  });

  ipcMain.handle('terminal:resize', (_event, { termId, cols, rows }: { termId: string; cols: number; rows: number }) => {
    const term = terminals.get(termId);
    if (term) term.resize(cols, rows);
  });

  ipcMain.handle('terminal:kill', (_event, termId: string) => {
    const term = terminals.get(termId);
    if (term) {
      term.kill();
      terminals.delete(termId);
    }
  });

  ipcMain.handle('show-context-menu', (event, type?: 'terminal' | 'global') => {
    const { Menu } = require('electron');
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Cut', role: 'cut' },
      { label: 'Copy', role: 'copy' },
      { label: 'Paste', role: 'paste' },
      { type: 'separator' },
      { label: 'Select All', role: 'selectAll' },
    ];
    if (type === 'terminal') {
      template.push({ type: 'separator' });
      template.push({ label: 'Clear', click: () => event.sender.send('terminal:clear') });
    }
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) ?? undefined });
  });
}
