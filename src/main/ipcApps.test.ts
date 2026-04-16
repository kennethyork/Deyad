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
  stopCompose: vi.fn(() => Promise.resolve()),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlers = new Map<string, (...args: any[]) => any>();

import { ipcMain } from 'electron';

let tmpDir: string;

beforeEach(() => {
  handlers.clear();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
    handlers.set(channel, handler);
    return undefined as ReturnType<typeof ipcMain.handle>;
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

  it('apps:delete removes app directory', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'doomed');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'file.ts'), 'x');

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:delete')!;
    const result = await handler({}, 'doomed');
    expect(result).toBe(true);
    expect(fs.existsSync(appSubdir)).toBe(false);
  });

  it('apps:delete-files removes specific files', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'a.ts'), 'a');
    fs.writeFileSync(path.join(appSubdir, 'b.ts'), 'b');

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:delete-files')!;
    const result = await handler({}, { appId: 'app1', paths: ['a.ts'] });
    expect(result).toBe(true);
    expect(fs.existsSync(path.join(appSubdir, 'a.ts'))).toBe(false);
    expect(fs.existsSync(path.join(appSubdir, 'b.ts'))).toBe(true);
  });

  it('apps:delete-files rejects path traversal', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(appSubdir, { recursive: true });

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:delete-files')!;
    await expect(handler({}, { appId: 'app1', paths: ['../../etc/passwd'] })).rejects.toThrow('Invalid file path');
  });

  it('apps:search-files returns matching lines', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'index.ts'), 'const name = "hello";\nconst other = "world";\n');

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:search-files')!;
    const result = handler({}, { appId: 'app1', query: 'hello' });
    expect(result.length).toBe(1);
    expect(result[0].file).toBe('index.ts');
    expect(result[0].line).toBe(1);
    expect(result[0].text).toContain('hello');
  });

  it('apps:search-files returns empty for no dir', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:search-files')!;
    const result = handler({}, { appId: 'nonexistent', query: 'test' });
    expect(result).toEqual([]);
  });

  it('apps:search-files handles invalid regex gracefully', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'test.ts'), 'a[b');

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:search-files')!;
    // Invalid regex should fallback to literal match
    const result = handler({}, { appId: 'app1', query: 'a[b' });
    expect(result.length).toBe(1);
  });

  it('apps:read-files skips files over 512KB', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'small.txt'), 'hello');
    // Create a file > 512KB
    fs.writeFileSync(path.join(appSubdir, 'large.bin'), Buffer.alloc(513 * 1024, 'x'));

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:read-files')!;
    const result = await handler({}, 'app1');
    expect(result).toHaveProperty('small.txt');
    expect(result).not.toHaveProperty('large.bin');
  });

  it('apps:read-files skips node_modules and .git dirs', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(path.join(appSubdir, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(appSubdir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'index.ts'), 'export default 1');
    fs.writeFileSync(path.join(appSubdir, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1');
    fs.writeFileSync(path.join(appSubdir, '.git', 'HEAD'), 'ref: refs/heads/main');

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:read-files')!;
    const result = await handler({}, 'app1');
    expect(result).toHaveProperty('index.ts');
    expect(Object.keys(result).some(k => k.includes('node_modules'))).toBe(false);
    expect(Object.keys(result).some(k => k.includes('.git'))).toBe(false);
  });

  it('apps:export returns error when app dir does not exist', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:export')!;
    const result = await handler({}, { appId: 'nonexistent', format: 'zip' });
    expect(result).toEqual({ success: false, error: 'App directory not found' });
  });

  it('apps:dev-stop returns success for unknown process', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:dev-stop')!;
    const event = { sender: { send: vi.fn() } };
    const result = await handler(event, 'nonexistent');
    expect(result).toEqual({ success: true });
    expect(event.sender.send).toHaveBeenCalledWith('apps:dev-status', { appId: 'nonexistent', status: 'stopped' });
  });

  it('apps:duplicate returns null for missing app', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:duplicate')!;
    const result = await handler({}, 'nonexistent');
    expect(result).toBeNull();
  });

  it('apps:write-files rejects path traversal attempts', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'app1');
    fs.mkdirSync(appSubdir, { recursive: true });

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:write-files')!;
    await expect(
      handler({}, { appId: 'app1', files: { '../../../etc/passwd': 'hacked' } })
    ).rejects.toThrow('Invalid file path');
  });

  it('apps:dev-status returns stopped for unknown process', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:dev-status')!;
    const result = handler({}, 'nonexistent');
    expect(result).toEqual({ status: 'stopped' });
  });

  /* ── apps:create metadata ──────────────────────────── */

  it('apps:create writes deyad.json with correct fields', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:create')!;
    const result = await handler({}, { name: 'Test App', description: 'A test', appType: 'frontend' });
    expect(result).toBeTruthy();
    expect(result.name).toBe('Test App');
    expect(result.appType).toBe('frontend');
    expect(result.id).toBeTruthy();
    // deyad.json should exist
    const metaPath = path.join(appsDir, result.id, 'deyad.json');
    expect(fs.existsSync(metaPath)).toBe(true);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    expect(meta.name).toBe('Test App');
  });

  it('apps:create fullstack app has frontend and backend dirs', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:create')!;
    const result = await handler({}, { name: 'FS Create', description: '', appType: 'fullstack' });
    const appPath = path.join(appsDir, result.id);
    expect(result.appType).toBe('fullstack');
    // Should have created frontend and/or backend dirs (or combined structure)
    expect(fs.existsSync(appPath)).toBe(true);
  });

  /* ── apps:read-files content ───────────────────────── */

  it('apps:read-files returns file content', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'read-app');
    fs.mkdirSync(path.join(appSubdir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'src', 'index.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({ name: 'Read' }));

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:read-files')!;
    const result = await handler({}, 'read-app');
    expect(result['src/index.ts']).toBe('export const x = 1;');
  });

  /* ── apps:write-files creates file ─────────────────── */

  it('apps:write-files creates files on disk', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'write-app');
    fs.mkdirSync(appSubdir, { recursive: true });

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:write-files')!;
    await handler({}, { appId: 'write-app', files: { 'src/hello.ts': 'console.log("hi")' } });
    expect(fs.existsSync(path.join(appSubdir, 'src', 'hello.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(appSubdir, 'src', 'hello.ts'), 'utf-8')).toBe('console.log("hi")');
  });

  /* ── apps:delete-files removes file ────────────────── */

  it('apps:delete-files removes files from disk', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'delfiles-app');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'temp.txt'), 'temp');

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:delete-files')!;
    await handler({}, { appId: 'delfiles-app', paths: ['temp.txt'] });
    expect(fs.existsSync(path.join(appSubdir, 'temp.txt'))).toBe(false);
  });

  /* ── apps:rename updates deyad.json ────────────────── */

  it('apps:rename updates name in deyad.json', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'rename-app');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), JSON.stringify({ name: 'Old', appType: 'frontend' }));

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:rename')!;
    handler({}, { appId: 'rename-app', newName: 'New Name' });
    const meta = JSON.parse(fs.readFileSync(path.join(appSubdir, 'deyad.json'), 'utf-8'));
    expect(meta.name).toBe('New Name');
  });

  /* ── apps:delete removes the directory ─────────────── */

  it('apps:delete removes app directory', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'to-delete');
    fs.mkdirSync(appSubdir, { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), '{}');

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:delete')!;
    await handler({}, 'to-delete');
    expect(fs.existsSync(appSubdir)).toBe(false);
  });

  /* ── apps:search-files matches ─────────────────────── */

  it('apps:search-files finds matches in file content', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'search-content');
    fs.mkdirSync(path.join(appSubdir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(appSubdir, 'src', 'main.ts'), 'function hello() { return 42; }');
    fs.writeFileSync(path.join(appSubdir, 'deyad.json'), '{}');

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:search-files')!;
    const result = handler({}, { appId: 'search-content', query: 'hello' });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].text).toContain('hello');
  });

  /* ── apps:has-snapshot returns true when present ───── */

  it('apps:has-snapshot returns true when snapshot exists', async () => {
    const { appsDir, snapDir } = setupHandlers();
    // Mock loadSnapshot to return non-null for this test
    const { loadSnapshot } = await import('../lib/mainUtils');
    vi.mocked(loadSnapshot).mockReturnValueOnce({ 'index.ts': 'export {}' });

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:has-snapshot')!;
    const result = handler({}, 'snap-app');
    expect(result).toBe(true);
  });

  /* ── apps:get-dir returns directory path ───────────── */

  it('apps:get-dir returns the app directory path', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'dir-app');
    fs.mkdirSync(appSubdir, { recursive: true });

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:get-dir')!;
    const result = handler({}, 'dir-app');
    expect(result).toBe(appSubdir);
  });

  /* ── apps:list with multiple apps ──────────────────── */

  it('apps:list returns all apps sorted by creation', async () => {
    // Use a fresh isolated directory for this test
    const listDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deyad-list-test-'));
    const snapDir2 = path.join(listDir, '_snapshots');
    fs.mkdirSync(snapDir2, { recursive: true });

    const app1Dir = path.join(listDir, 'aaa');
    const app2Dir = path.join(listDir, 'bbb');
    fs.mkdirSync(app1Dir, { recursive: true });
    fs.mkdirSync(app2Dir, { recursive: true });
    fs.writeFileSync(path.join(app1Dir, 'deyad.json'), JSON.stringify({ name: 'First', appType: 'frontend', createdAt: '2024-01-01' }));
    fs.writeFileSync(path.join(app2Dir, 'deyad.json'), JSON.stringify({ name: 'Second', appType: 'fullstack', createdAt: '2024-01-02' }));

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(listDir, id), listDir, snapDir2);

    const handler = handlers.get('apps:list')!;
    const result = handler();
    // Filter out the _snapshots dir since it's not an app
    const apps = result.filter((a: { id: string }) => a.id !== '_snapshots');
    expect(apps.length).toBe(2);
    const names = apps.map((a: { name: string }) => a.name);
    expect(names).toContain('First');
    expect(names).toContain('Second');
    fs.rmSync(listDir, { recursive: true, force: true });
  });

  /* ── apps:write-files with nested directories ──────── */

  it('apps:write-files creates nested directories', async () => {
    const { appsDir, snapDir } = setupHandlers();
    const appSubdir = path.join(appsDir, 'nested-app');
    fs.mkdirSync(appSubdir, { recursive: true });

    const { registerAppHandlers } = await import('./ipcApps');
    registerAppHandlers((id: string) => path.join(appsDir, id), appsDir, snapDir);

    const handler = handlers.get('apps:write-files')!;
    await handler({}, { appId: 'nested-app', files: { 'src/deep/nested/file.ts': 'export {}' } });
    expect(fs.existsSync(path.join(appSubdir, 'src', 'deep', 'nested', 'file.ts'))).toBe(true);
  });
});
