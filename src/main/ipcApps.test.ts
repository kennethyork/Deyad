import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

vi.mock('electron', () => ({
  dialog: {
    showSaveDialog: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn() },
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
  spawn: vi.fn(() => ({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
  })),
}));

vi.mock('../lib/crc32', () => ({
  crc32: vi.fn(() => 0),
}));

vi.mock('../lib/mainUtils', () => ({
  safeAppId: vi.fn((id: string) => id),
  saveSnapshot: vi.fn(),
  loadSnapshot: vi.fn(() => null),
  deleteSnapshot: vi.fn(),
}));

vi.mock('./ipcGit', () => ({
  gitInit: vi.fn(),
  gitCommit: vi.fn(),
}));

vi.mock('./ipcDocker', () => ({
  stopCompose: vi.fn(),
}));

const handlers = new Map<string, Function>();

import { ipcMain } from 'electron';

let tmpDir: string;

beforeEach(() => {
  handlers.clear();
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
    handlers.set(channel, handler);
    return undefined as any;
  });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-apps-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('ipcApps handler registration', () => {
  const snapshotsDir = () => path.join(tmpDir, 'snapshots');

  function setupHandlers() {
    const appsDir = tmpDir;
    const snapDir = snapshotsDir();
    fs.mkdirSync(snapDir, { recursive: true });
    return { appsDir, snapDir };
  }

  it('registers all expected app handlers', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const expected = [
      'apps:list', 'apps:create', 'apps:read-files', 'apps:write-files',
      'apps:delete-files', 'apps:delete', 'apps:get-dir', 'apps:open-folder', 'apps:rename',
      'apps:save-messages', 'apps:load-messages', 'apps:dev-start', 'apps:dev-stop',
      'apps:dev-status', 'apps:export', 'apps:snapshot', 'apps:has-snapshot', 'apps:revert',
      'apps:import',
    ];
    for (const ch of expected) {
      expect(handlers.has(ch), `handler '${ch}' should be registered`).toBe(true);
    }
  });

  it('apps:list returns empty array for empty dir', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:list')!;
    const result = handler();
    expect(Array.isArray(result)).toBe(true);
  });

  it('apps:list returns apps with metadata', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'test-app');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({
      name: 'Test App', description: 'A test', createdAt: '2024-01-01', appType: 'frontend',
    }));

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:list')!;
    const result = handler();
    expect(result.length).toBeGreaterThanOrEqual(1);
    const app = result.find((a: { id: string }) => a.id === 'test-app');
    expect(app).toBeDefined();
    expect(app.name).toBe('Test App');
  });

  it('apps:create creates a directory with metadata', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:create')!;
    const result = await handler({}, { name: 'My App', description: 'desc', appType: 'frontend' });
    expect(result.name).toBe('My App');
    expect(result.id).toBeTruthy();
    expect(fs.existsSync(path.join(appsDir, result.id, 'deyad.json'))).toBe(true);
  });

  it('apps:read-files returns empty for nonexistent dir', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:read-files')!;
    const result = handler({}, 'nonexistent');
    expect(result).toEqual({});
  });

  it('apps:read-files returns files from app directory', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'index.ts'), 'console.log("hello")');

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:read-files')!;
    const result = handler({}, 'app1');
    expect(result['index.ts']).toBe('console.log("hello")');
  });

  it('apps:write-files writes files to app directory', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(appSubdir, { recursive: true });

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:write-files')!;
    await handler({}, { appId: 'app1', files: { 'src/main.ts': 'export {}' } });
    expect(fs.readFileSync(path.join(appSubdir, 'src', 'main.ts'), 'utf-8')).toBe('export {}');
  });

  it('apps:rename updates metadata name', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({ name: 'Old Name' }));

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:rename')!;
    const result = handler({}, { appId: 'app1', newName: 'New Name' });
    expect(result).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(appSubdir, 'deyad.json'), 'utf-8'));
    expect(meta.name).toBe('New Name');
  });

  it('apps:save-messages saves and apps:load-messages loads', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(appSubdir, { recursive: true });

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const msgs = [{ role: 'user', content: 'hello' }];
    const saveHandler = handlers.get('apps:save-messages')!;
    saveHandler({}, { appId: 'app1', messages: msgs });

    const loadHandler = handlers.get('apps:load-messages')!;
    const loaded = loadHandler({}, 'app1');
    expect(loaded).toEqual(msgs);
  });

  it('apps:dev-status returns stopped for unknown app', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:dev-status')!;
    const result = handler({}, 'unknown-app');
    expect(result).toEqual({ status: 'stopped' });
  });

  it('apps:has-snapshot returns false when no snapshot', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:has-snapshot')!;
    const result = handler({}, 'app1');
    expect(result).toBe(false);
  });

  it('apps:revert returns error when no snapshot', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:revert')!;
    const result = await handler({}, 'app1');
    expect(result).toEqual({ success: false, error: 'No snapshot available' });
  });

  it('apps:get-dir returns app dir or apps dir', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:get-dir')!;
    expect(handler({}, 'app1')).toBe(path.join(appsDir, 'app1'));
    expect(handler({})).toBe(appsDir);
  });
});
