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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers = new Map<string, (...args: any[]) => any>();

import { ipcMain } from 'electron';

beforeEach(() => {
  handlers.clear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
    handlers.set(channel, handler);
    return undefined as ReturnType<typeof ipcMain.handle>;
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
  }, 30_000);

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

  /* ── deploy-vps validation edge cases ──────────────── */

  it('deploy-vps rejects shell metacharacters in user', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps-user');
    fs.mkdirSync(appSubdir, { recursive: true });
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', { host: 'example.com', user: 'root;echo', path: '/var/www' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid characters');
  });

  it('deploy-vps rejects shell metacharacters in path', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps-path');
    fs.mkdirSync(appSubdir, { recursive: true });
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', { host: 'example.com', user: 'root', path: '/var/www;rm -rf /' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid characters');
  });

  it('deploy-vps rejects missing user field', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps-nouser');
    fs.mkdirSync(appSubdir, { recursive: true });
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', { host: 'example.com', user: '', path: '/var/www' });
    expect(result.success).toBe(false);
  });

  it('deploy-vps rejects missing path field', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps-nopath');
    fs.mkdirSync(appSubdir, { recursive: true });
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', { host: 'example.com', user: 'root', path: '' });
    expect(result.success).toBe(false);
  });

  /* ── deploy-vps domain validation ──────────────────── */

  it('deploy-vps accepts domain with subdomain', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps-subdomain');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({ name: 'Test', appType: 'frontend' }));
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', { host: 'example.com', user: 'deploy', path: '/var/www', domain: 'sub.domain.example.com' });
    // Validation should pass (will fail at build step)
    expect(result.error).not.toContain('Invalid domain');
  }, 30_000);

  it('deploy-vps rejects domain with port', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps-port');
    fs.mkdirSync(appSubdir, { recursive: true });
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', { host: 'example.com', user: 'root', path: '/var/www', domain: 'app.example.com:8080' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid domain');
  });

  /* ── deploy-electron ───────────────────────────────── */

  it('deploy-electron creates app dir with deyad.json and attempts build', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-electron');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({ name: 'Elec App', appType: 'frontend' }));
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-electron')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1');
    // Will fail because vite/electron aren't installed, but shouldn't crash during scaffold generation
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  /* ── deploy provider not found ─────────────────────── */

  it('deploy with unknown provider returns error', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-unknown');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({ name: 'Unknown', appType: 'frontend' }));
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', 'nonexistent_provider');
    expect(result.success).toBe(false);
  });

  it('deploy-fullstack with unknown provider returns error', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-unknown2');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({ name: 'Unknown', appType: 'fullstack' }));
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-fullstack')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', 'nonexistent_provider');
    expect(result.success).toBe(false);
  });

  /* ── deploy-check structure ────────────────────────── */

  it('deploy-check returns boolean values for all providers', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    registerDeployHandlers((_id: string) => tmpDir);

    const handler = handlers.get('apps:deploy-check')!;
    const result = await handler({});
    const keys = Object.keys(result);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const k of keys) {
      expect(typeof result[k]).toBe('boolean');
    }
  });

  /* ── deploy with existing dir but no vite ──────────── */

  it('deploy frontend fails gracefully when no vite build available', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-novite');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({ name: 'No Vite', appType: 'frontend' }));
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', 'netlify');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  /* ── deploy-vps without domain ─────────────────────── */

  it('deploy-vps accepts missing domain (no SSL)', async () => {
    const { registerDeployHandlers } = await import('./ipcDeploy');
    const appSubdir = path.join(tmpDir, 'app-vps-nodomain');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({ name: 'VPS Test', appType: 'frontend' }));
    registerDeployHandlers((_id: string) => appSubdir);

    const handler = handlers.get('apps:deploy-vps')!;
    const event = { sender: { id: 1 } };
    const result = await handler(event, 'app1', { host: 'example.com', user: 'root', path: '/var/www' });
    // Will fail at build step but should pass validation (no domain = no SSL)
    expect(result.error).not.toContain('Invalid domain');
    expect(result.error).not.toContain('required');
  }, 30_000);
});
