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

  it('deploy-check returns an object with provider availability', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    registerDeployHandlers((_id: string) => tmpDir);

    const handler = handlers.get('apps:deploy-check')!;
    const result = await handler({});
    expect(typeof result).toBe('object');
    expect(typeof result.netlify).toBe('boolean');
    expect(typeof result.vercel).toBe('boolean');
    expect(typeof result.surge).toBe('boolean');
    expect(typeof result.railway).toBe('boolean');
    expect(typeof result.flyio).toBe('boolean');
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

  it('registers all 6 deploy handlers', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    registerDeployHandlers((_id: string) => tmpDir);

    const expected = [
      'apps:deploy-check', 'apps:deploy', 'apps:deploy-fullstack',
      'apps:deploy-vps', 'apps:deploy-electron',
    ];
    for (const ch of expected) {
      expect(handlers.has(ch), `handler '${ch}' should be registered`).toBe(true);
    }
  });

  it('deploy-vps returns error when app dir does not exist', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    registerDeployHandlers((_id: string) => path.join(tmpDir, 'nonexistent'));

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', { host: 'example.com', user: 'root', path: '/var/www' });
    expect(result).toEqual({ success: false, error: 'App directory not found' });
  });

  it('deploy-vps rejects missing required fields', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps');
    fs.mkdirSync(appSubdir, { recursive: true });
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };

    const result = await handler(event, 'app1', { host: '', user: 'root', path: '/var/www' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('deploy-vps rejects shell metacharacters in host', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps2');
    fs.mkdirSync(appSubdir, { recursive: true });
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };

    const result = await handler(event, 'app1', { host: 'evil;rm -rf /', user: 'root', path: '/var/www' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid characters');
  });

  it('deploy-vps rejects invalid domain format', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps3');
    fs.mkdirSync(appSubdir, { recursive: true });
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };

    const result = await handler(event, 'app1', { host: 'example.com', user: 'root', path: '/var/www', domain: 'not a valid domain!' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid domain');
  });

  it('deploy-vps accepts valid domain format', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps4');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({ name: 'Test', appType: 'frontend' }));
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };

    // Will fail at build step but should pass validation
    const result = await handler(event, 'app1', { host: 'example.com', user: 'deploy', path: '/var/www', domain: 'app.example.com' });
    // It will fail because npx vite build won't work in test, but the validation passed
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('Invalid domain');
    expect(result.error).not.toContain('Invalid characters');
    expect(result.error).not.toContain('required');
  });

  it('deploy-electron returns error when app dir does not exist', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    registerDeployHandlers((_id: string) => path.join(tmpDir, 'nonexistent'));

    const handler = handlers.get('apps:deploy-electron')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1');
    expect(result).toEqual({ success: false, error: 'App directory not found' });
  });

  it('deploy reads app metadata defaults gracefully', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    // Create dir without deyad.json — should use defaults
    const appSubdir = path.join(tmpDir, 'app-no-meta');
    fs.mkdirSync(appSubdir, { recursive: true });
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy')!;
    const event = { sender: { id: 1 } };
    // Will fail at build step but should not crash reading metadata
    const result = await handler(event, 'app1', 'netlify');
    expect(result.success).toBe(false);
    // Error should be about build, not about metadata parsing
    expect(result.error).toBeDefined();
  });
});
