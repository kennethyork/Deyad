/**
 * Terminal IPC handlers (node-pty).
 */

import { BrowserWindow, ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const terminals = new Map<string, any>();

export function getTerminals(): typeof terminals {
  return terminals;
}

export function registerTerminalHandlers(appDir: (id: string) => string): void {
  ipcMain.handle('terminal:start', (_event, { appId }: { appId?: string }) => {
    let pty;
    try {
      pty = require('node-pty');
    } catch {
      throw new Error('node-pty is not available. Rebuild native modules with electron-rebuild.');
    }
    const cwd = appId ? appDir(appId) : undefined;
    const shellPath = process.platform === 'win32' ? 'cmd.exe' : process.env.SHELL || '/bin/bash';
    const term = pty.spawn(shellPath, [], { cwd, env: process.env });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const template: any[] = [
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
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
  });
}
