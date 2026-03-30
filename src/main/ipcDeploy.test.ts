import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

// We test the pure logic pieces that don't depend on ipcMain registration.
// The deploy handlers call execFileAsync + fs — we mock child_process.

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => ({ webContents: { send: vi.fn() } })) },
}));

// Capture handlers registered via ipcMain.handle
const handlers = new Map<string, Function>();

import { ipcMain } from 'electron';

beforeEach(() => {
  handlers.clear();
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
    handlers.set(channel, handler);
    return undefined as any;
  });
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-deploy-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('ipcDeploy handler registration', () => {
  it('registers deploy-check, deploy, and deploy-fullstack handlers', async () => {
    // Dynamic import after mocks are set up
    const { registerDeployHandlers } = await import('./ipcDeploy');
    registerDeployHandlers((_id: string) => tmpDir);

    expect(handlers.has('apps:deploy-check')).toBe(true);
    expect(handlers.has('apps:deploy')).toBe(true);
    expect(handlers.has('apps:deploy-fullstack')).toBe(true);
  });

  it('deploy returns error when app dir does not exist', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    registerDeployHandlers((_id: string) => path.join(tmpDir, 'nonexistent'));

    const handler = handlers.get('apps:deploy')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', 'netlify');
    expect(result).toEqual({ success: false, error: 'App directory not found' });
  });

  it('deploy-fullstack returns error when app dir does not exist', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    registerDeployHandlers((_id: string) => path.join(tmpDir, 'nonexistent'));

    const handler = handlers.get('apps:deploy-fullstack')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', 'railway');
    expect(result).toEqual({ success: false, error: 'App directory not found' });
  });
});
